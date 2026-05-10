import {
  MAJOR_FAMILIES,
  STUDY_ABROAD_PROGRAMS,
  STUDY_ABROAD_DATA_UPDATED_AT,
} from "./study-abroad-programs";
import {
  readStudyAbroadCatalogPrograms,
  readStudyAbroadCatalogUniversities,
  writeStudyAbroadCatalogPrograms,
  writeStudyAbroadCatalogUniversities,
  type StudyAbroadCatalogProgram,
  type StudyAbroadCatalogUniversity,
} from "./study-abroad-catalog-store";
import { slugify } from "./text-fields";

type HipoUniversity = {
  name?: string;
  country?: string;
  state_province?: string | null;
  domains?: string[];
  web_pages?: string[];
};

type ScorecardProgram = {
  code?: string;
  title?: string;
  credential?: {
    level?: number;
    title?: string;
  };
};

type ScorecardSchool = {
  id?: number;
  school?: {
    name?: string;
    city?: string;
    state?: string;
    school_url?: string;
    main_campus?: number;
    operating?: number;
  };
  latest?: {
    cost?: {
      tuition?: {
        in_state?: number | null;
        out_of_state?: number | null;
      };
    };
    programs?: {
      cip_4_digit?: ScorecardProgram[];
    };
  };
};

type ImportOptions = {
  maxPages?: number;
  perPage?: number;
};

const HIPO_US_URL =
  "https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json";
const SCORECARD_URL = "https://api.data.gov/ed/collegescorecard/v1/schools";
const DEFAULT_SCORECARD_PAGES = 10;
const DEFAULT_PER_PAGE = 100;
const SCORECARD_PAGE_DELAY_MS = 450;
const SCORECARD_API_KEY =
  import.meta.env?.COLLEGE_SCORECARD_API_KEY ||
  process.env.COLLEGE_SCORECARD_API_KEY ||
  "DEMO_KEY";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function tokenizeText(value: string) {
  return new Set(normalizeText(value).split(" ").filter(Boolean));
}

function matchKeyword(text: string, tokens: Set<string>, keyword: string) {
  const normalized = normalizeText(keyword);
  if (!normalized) return false;

  if (normalized.includes(" ") || normalized.length > 2) {
    return text.includes(normalized);
  }

  return tokens.has(normalized);
}

function detectDiscipline(title: string) {
  const text = normalizeText(title);
  const tokens = tokenizeText(text);

  for (const [label, aliases] of Object.entries(MAJOR_FAMILIES)) {
    if (aliases.some((alias) => matchKeyword(text, tokens, alias))) {
      return label;
    }
  }

  return title.trim() || "未分类项目";
}

function makeUsUniversityId(name: string, stateOrProvince: string) {
  return slugify(`${name}-${stateOrProvince || "us"}`) || crypto.randomUUID().slice(0, 8);
}

function withHttps(url: string) {
  const cleaned = String(url || "").trim();
  if (!cleaned) return "";
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

function websiteHost(url: string) {
  try {
    return new URL(withHttps(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cleanDomain(domain: string) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      const error = new Error(`Request failed: ${response.status}`) as Error & {
        status?: number;
      };
      error.status = response.status;
      throw error;
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url: string, init?: RequestInit, retries = 4): Promise<any> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url, init);
    } catch (error) {
      lastError = error;

      const status = Number((error as { status?: number })?.status ?? 0);
      const isLastAttempt = attempt === retries;
      if (isLastAttempt) {
        break;
      }

      if (status === 429) {
        await sleep(2500 * (attempt + 1));
        continue;
      }

      await sleep(700 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("请求失败");
}

async function fetchUsHipoUniversities() {
  const raw = (await fetchWithRetry(HIPO_US_URL)) as HipoUniversity[];

  return raw
    .filter((item) => item.country === "United States")
    .map((item) => {
      const website = withHttps(item.web_pages?.[0] || "");
      const domain = cleanDomain(item.domains?.[0] || websiteHost(website));
      const stateOrProvince = String(item.state_province || "").trim();
      const name = String(item.name || "").trim();

      return {
        id: makeUsUniversityId(name, stateOrProvince),
        name,
        nameZh: "",
        country: "美国",
        city: "",
        stateOrProvince,
        officialWebsite: website,
        websiteDomain: domain,
        qsRank: null,
        qsRankingYear: null,
        rankingSource: "",
        sourceIds: ["hipolabs-university-domains"],
        updatedAt: STUDY_ABROAD_DATA_UPDATED_AT,
      } satisfies StudyAbroadCatalogUniversity;
    })
    .filter((item) => item.name && item.websiteDomain);
}

async function fetchScorecardSchools(options: Required<ImportOptions>) {
  const results: ScorecardSchool[] = [];

  for (let page = 0; page < options.maxPages; page += 1) {
    const params = new URLSearchParams({
      api_key: SCORECARD_API_KEY,
      fields: "id,school,latest.cost,latest.programs",
      keys_nested: "true",
      all_programs_nested: "true",
      per_page: String(options.perPage),
      page: String(page),
      sort: "latest.student.size:desc",
      "school.operating": "1",
      "school.main_campus": "1",
    });

    const payload = await fetchWithRetry(`${SCORECARD_URL}?${params.toString()}`);
    const pageResults = Array.isArray(payload?.results) ? payload.results : [];

    results.push(...pageResults);

    if (!pageResults.length || pageResults.length < options.perPage) {
      break;
    }

    if (page < options.maxPages - 1) {
      await sleep(SCORECARD_PAGE_DELAY_MS);
    }
  }

  return results;
}

function mergeSourceIds(current: string[], incoming: string[]) {
  return Array.from(new Set([...current, ...incoming].filter(Boolean)));
}

function mergeUsUniversities(
  hipoUniversities: StudyAbroadCatalogUniversity[],
  schools: ScorecardSchool[],
  existingUniversities: StudyAbroadCatalogUniversity[]
) {
  const map = new Map<string, StudyAbroadCatalogUniversity>();

  existingUniversities.forEach((item) => {
    if (item.country === "美国") {
      map.set(item.id, item);
    }
  });

  hipoUniversities.forEach((item) => {
    map.set(item.id, item);
  });

  const idByDomain = new Map<string, string>();
  const idByNameState = new Map<string, string>();

  Array.from(map.values()).forEach((item) => {
    if (item.websiteDomain) {
      idByDomain.set(item.websiteDomain, item.id);
    }

    idByNameState.set(
      slugify(`${item.name}-${item.stateOrProvince || "us"}`),
      item.id
    );
  });

  schools.forEach((school) => {
    const name = String(school.school?.name || "").trim();
    if (!name) return;

    const stateOrProvince = String(school.school?.state || "").trim();
    const city = String(school.school?.city || "").trim();
    const officialWebsite = withHttps(String(school.school?.school_url || "").trim());
    const websiteDomain = cleanDomain(officialWebsite || websiteHost(officialWebsite));
    const key = slugify(`${name}-${stateOrProvince || "us"}`);
    const existingId =
      (websiteDomain ? idByDomain.get(websiteDomain) : "") || idByNameState.get(key) || "";

    const nextId = existingId || makeUsUniversityId(name, stateOrProvince);
    const current = map.get(nextId);

    const nextItem: StudyAbroadCatalogUniversity = {
      id: nextId,
      name,
      nameZh: current?.nameZh || "",
      country: "美国",
      city,
      stateOrProvince,
      officialWebsite: officialWebsite || current?.officialWebsite || "",
      websiteDomain: websiteDomain || current?.websiteDomain || "",
      qsRank: current?.qsRank ?? null,
      qsRankingYear: current?.qsRankingYear ?? null,
      rankingSource: current?.rankingSource ?? "",
      sourceIds: mergeSourceIds(current?.sourceIds ?? [], ["college-scorecard"]),
      updatedAt: new Date().toISOString().slice(0, 10),
    };

    map.set(nextId, nextItem);

    if (nextItem.websiteDomain) {
      idByDomain.set(nextItem.websiteDomain, nextId);
    }
    idByNameState.set(key, nextId);
  });

  return Array.from(map.values()).sort((left, right) =>
    `${left.stateOrProvince}-${left.name}`.localeCompare(
      `${right.stateOrProvince}-${right.name}`,
      "en-US"
    )
  );
}

function formatUsdAmount(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) {
    return "";
  }

  return String(Math.round(Number(value)));
}

function buildUsPrograms(
  schools: ScorecardSchool[],
  universities: StudyAbroadCatalogUniversity[],
  existingPrograms: StudyAbroadCatalogProgram[]
) {
  const universityByKey = new Map<string, StudyAbroadCatalogUniversity>();
  const universityByDomain = new Map<string, StudyAbroadCatalogUniversity>();

  universities.forEach((item) => {
    universityByKey.set(
      slugify(`${item.name}-${item.stateOrProvince || "us"}`),
      item
    );

    if (item.websiteDomain) {
      universityByDomain.set(item.websiteDomain, item);
    }
  });

  const preservedPrograms = existingPrograms.filter(
    (item) => item.country !== "美国" || !item.sourceIds.includes("college-scorecard")
  );
  const existingProgramMap = new Map(existingPrograms.map((item) => [item.id, item]));
  const manualPrograms = buildCuratedUsPrograms(universities, existingPrograms);
  const importedPrograms = new Map<string, StudyAbroadCatalogProgram>();

  schools.forEach((school) => {
    const name = String(school.school?.name || "").trim();
    if (!name) return;

    const stateOrProvince = String(school.school?.state || "").trim();
    const domain = cleanDomain(String(school.school?.school_url || ""));
    const university =
      (domain ? universityByDomain.get(domain) : undefined) ||
      universityByKey.get(slugify(`${name}-${stateOrProvince || "us"}`));

    if (!university) {
      return;
    }

    const programs = Array.isArray(school.latest?.programs?.cip_4_digit)
      ? school.latest?.programs?.cip_4_digit
      : [];

    const outOfState = school.latest?.cost?.tuition?.out_of_state;
    const inState = school.latest?.cost?.tuition?.in_state;
    const tuitionAmount = formatUsdAmount(outOfState ?? inState ?? null);
    const tuitionNotes = tuitionAmount
      ? "当前为 College Scorecard 提供的学校层 tuition 字段，暂未细分到每个项目页面。"
      : "";

    programs.forEach((program) => {
      if (Number(program.credential?.level) !== 5) {
        return;
      }

      const code = String(program.code || "").trim();
      const title = String(program.title || "").trim().replace(/\.$/, "");
      if (!code || !title) return;

      const programId = slugify(`${university.id}-${code}-masters`) || crypto.randomUUID().slice(0, 8);
      if (importedPrograms.has(programId)) {
        return;
      }

      const current = existingProgramMap.get(programId);

      importedPrograms.set(programId, {
        ...current,
        id: programId,
        universityId: university.id,
        schoolName: university.name,
        schoolNameZh: current?.schoolNameZh || university.nameZh || "",
        country: "美国",
        city: university.city,
        stateOrProvince: university.stateOrProvince,
        programName: title,
        degree: "硕士",
        discipline: detectDiscipline(title),
        summary: `该项目来自 College Scorecard 的美国官方 field of study 数据，专业标题为 ${title}。`,
        duration: "",
        intake: "",
        tuitionAmount,
        tuitionCurrency: tuitionAmount ? "USD" : "",
        tuitionNotes,
        overviewUrl: university.officialWebsite || `https://${university.websiteDomain}`,
        admissionsUrl: university.officialWebsite || `https://${university.websiteDomain}`,
        tuitionUrl: university.officialWebsite || `https://${university.websiteDomain}`,
        keywords: [title, code, detectDiscipline(title)].filter(Boolean),
        tags: ["美国", "College Scorecard", "官方项目数据", code],
        sourceIds: Array.from(
          new Set([...(current?.sourceIds ?? []), "college-scorecard"])
        ),
        checkedAt: new Date().toISOString().slice(0, 10),
        priority: 60,
      });
    });
  });

  const mergedPrograms = new Map<string, StudyAbroadCatalogProgram>();

  [...preservedPrograms, ...manualPrograms, ...Array.from(importedPrograms.values())].forEach(
    (item) => {
      if (!item.id) return;
      mergedPrograms.set(item.id, item);
    }
  );

  return Array.from(mergedPrograms.values());
}

function buildCuratedUsPrograms(
  universities: StudyAbroadCatalogUniversity[],
  existingPrograms: StudyAbroadCatalogProgram[]
) {
  const universityByDomain = new Map<string, StudyAbroadCatalogUniversity>();
  const universityByName = new Map<string, StudyAbroadCatalogUniversity>();

  universities.forEach((item) => {
    if (item.country !== "美国") {
      return;
    }

    if (item.websiteDomain) {
      universityByDomain.set(cleanDomain(item.websiteDomain), item);
    }

    universityByName.set(normalizeText(item.name), item);
  });

  const existingProgramMap = new Map(existingPrograms.map((item) => [item.id, item]));

  return STUDY_ABROAD_PROGRAMS.filter((program) => program.country === "美国").map((program) => {
    const domain = cleanDomain(websiteHost(program.overviewUrl));
    const matchedUniversity =
      (domain ? universityByDomain.get(domain) : undefined) ||
      universityByName.get(normalizeText(program.schoolName));
    const current = existingProgramMap.get(program.id);

    return {
      ...current,
      id: program.id,
      universityId:
        matchedUniversity?.id || slugify(program.schoolName) || crypto.randomUUID().slice(0, 8),
      schoolName: program.schoolName,
      schoolNameZh: matchedUniversity?.nameZh || current?.schoolNameZh || "",
      country: "美国",
      city: program.city,
      stateOrProvince: matchedUniversity?.stateOrProvince || "",
      programName: program.programName,
      degree: program.degree,
      discipline: program.discipline,
      summary: program.summary,
      duration: program.duration || "",
      intake: program.intake || "",
      tuitionAmount: "",
      tuitionCurrency: "",
      tuitionNotes: "",
      overviewUrl: program.overviewUrl,
      admissionsUrl: program.admissionsUrl || "",
      tuitionUrl: "",
      keywords: program.keywords,
      tags: program.tags,
      sourceIds: Array.from(
        new Set([...(current?.sourceIds ?? []), "curated-manual"])
      ),
      checkedAt: program.checkedAt,
      priority: program.priority,
    } satisfies StudyAbroadCatalogProgram;
  });
}

export async function syncUsStudyAbroadCatalog(options: ImportOptions = {}) {
  const config = {
    maxPages: options.maxPages ?? DEFAULT_SCORECARD_PAGES,
    perPage: options.perPage ?? DEFAULT_PER_PAGE,
  };

  let existingUniversities: StudyAbroadCatalogUniversity[];
  let existingPrograms: StudyAbroadCatalogProgram[];
  let hipoUniversities: StudyAbroadCatalogUniversity[];
  let scorecardSchools: ScorecardSchool[];

  try {
    [existingUniversities, existingPrograms, hipoUniversities, scorecardSchools] =
      await Promise.all([
        readStudyAbroadCatalogUniversities(),
        readStudyAbroadCatalogPrograms(),
        fetchUsHipoUniversities(),
        fetchScorecardSchools(config),
      ]);
  } catch (error) {
    const status = Number((error as { status?: number })?.status ?? 0);

    if (status === 429) {
      if (SCORECARD_API_KEY === "DEMO_KEY") {
        throw new Error(
          "College Scorecard demo key 在大范围同步时触发了限流。当前建议先同步 10 页；如果要继续放大到 20-30 页，请先配置正式的 COLLEGE_SCORECARD_API_KEY。"
        );
      }

      throw new Error("College Scorecard API 触发限流，请稍后重试，或先降低同步页数。");
    }

    throw error;
  }

  const mergedUsUniversities = mergeUsUniversities(
    hipoUniversities,
    scorecardSchools,
    existingUniversities
  );

  const nextUniversities = [
    ...existingUniversities.filter((item) => item.country !== "美国"),
    ...mergedUsUniversities,
  ];

  const nextPrograms = buildUsPrograms(scorecardSchools, nextUniversities, existingPrograms);

  const savedUniversities = await writeStudyAbroadCatalogUniversities(nextUniversities);
  const savedPrograms = await writeStudyAbroadCatalogPrograms(nextPrograms);

  const importedUsPrograms = savedPrograms.filter(
    (item) => item.country === "美国" && item.sourceIds.includes("college-scorecard")
  );
  const importedUsUniversities = savedUniversities.filter((item) => item.country === "美国");

  return {
    ok: true,
    usingDemoKey: SCORECARD_API_KEY === "DEMO_KEY",
    importedUniversityCount: importedUsUniversities.length,
    importedProgramCount: importedUsPrograms.length,
    hipoUniversitySeedCount: hipoUniversities.length,
    scorecardSchoolCount: scorecardSchools.length,
    message:
      SCORECARD_API_KEY === "DEMO_KEY"
        ? `已用 demo key 完成美国试点同步：${importedUsUniversities.length} 所学校，${importedUsPrograms.length} 个硕士项目。`
        : `已完成美国试点同步：${importedUsUniversities.length} 所学校，${importedUsPrograms.length} 个硕士项目。`,
  };
}
