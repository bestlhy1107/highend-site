import { randomUUID } from "node:crypto";
import {
  readStudyAbroadCatalogProgramLinkIndex,
  readStudyAbroadCatalogPrograms,
  readStudyAbroadCatalogUniversities,
  writeStudyAbroadCatalogPrograms,
  writeStudyAbroadCatalogUniversities,
  type StudyAbroadCatalogProgram,
  type StudyAbroadCatalogUniversity,
} from "./study-abroad-catalog-store";
import { getStudyAbroadUniversityNameZh } from "./study-abroad-university-names";
import {
  MAJOR_FAMILIES,
  MAJOR_QUERY_ALIASES,
  SPECIALIZATION_QUERY_ALIASES,
  SPECIALIZATION_TO_MAJOR,
} from "./study-abroad-programs";
import { readStudyAbroadReviewQueue } from "./study-abroad-review-queue";
import {
  isBlockedStudyAbroadCandidate,
  readStudyAbroadSearchBlocklist,
} from "./study-abroad-search-governance";
import { slugify } from "./text-fields";

const REVIEW_IMPORT_SOURCE_ID = "review-queue-manual-import";
const FETCH_TIMEOUT_MS = 8000;
const DEFAULT_BATCH_IMPORT_LIMIT = 2;
const MAX_BATCH_IMPORT_LIMIT = 10;
const BATCH_IMPORT_TIME_BUDGET_MS = 22_000;
const DISCIPLINE_EXTRA_HINTS: Record<string, string[]> = {
  "建筑 / 城市规划": [
    "architectural",
    "architecture",
    "planning",
    "urban design",
    "urbanism",
    "landscape",
  ],
  "设计 / 艺术": [
    "design strategy",
    "design management",
    "visual",
    "creative",
    "service design",
    "industrial design",
  ],
};

function normalizeText(value?: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeWhitespace(value?: string) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function tokenizeText(value: string) {
  return new Set(
    normalizeText(value)
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function isAsciiSingleTokenKeyword(value: string) {
  return /^[a-z0-9]+$/i.test(value);
}

function matchNormalizedKeyword(
  searchText: string,
  tokenSet: Set<string>,
  rawKeyword: string
) {
  const keyword = normalizeText(rawKeyword);
  if (!keyword) return false;

  if (keyword.includes(" ")) {
    return searchText.includes(keyword);
  }

  if (isAsciiSingleTokenKeyword(keyword)) {
    return tokenSet.has(keyword);
  }

  return searchText.includes(keyword);
}

function cleanDomain(value?: string) {
  return String(value || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function extractHost(value?: string) {
  try {
    return new URL(String(value || "")).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeLink(value?: string) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return String(value || "").trim();
  }
}

function isPdfLink(value?: string) {
  const normalized = normalizeLink(value).toLowerCase();
  return normalized.endsWith(".pdf");
}

function hostMatchesDomain(host: string, domain: string) {
  return Boolean(
    host &&
      domain &&
      (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`))
  );
}

function looksLikeSchoolName(value: string) {
  return /university|college|institute|polytechnic|school|academy|arts/i.test(value);
}

function extractSchoolNameFromTitle(pageTitle: string) {
  const parts = normalizeWhitespace(pageTitle)
    .split(/\s+[|｜]\s+|\s+[—–-]\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (looksLikeSchoolName(parts[index])) {
      return parts[index];
    }
  }

  return "";
}

function cleanProgramTitle(value: string) {
  return normalizeWhitespace(value)
    .replace(/\(\d{4}\s*entry\)/gi, "")
    .replace(/\(\d{4}\)/g, "")
    .trim();
}

function extractProgramName(title: string, pageTitle?: string) {
  const normalizedTitle = cleanProgramTitle(title);
  const normalizedPageTitle = cleanProgramTitle(pageTitle || "");
  const schoolName = extractSchoolNameFromTitle(normalizedPageTitle);

  if (normalizedPageTitle && schoolName) {
    const escaped = schoolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stripped = normalizedPageTitle
      .replace(new RegExp(`\\s*[|｜—–-]\\s*${escaped}\\s*$`, "i"), "")
      .trim();

    if (stripped) {
      return stripped;
    }
  }

  return normalizedTitle;
}

function normalizeDegree(value: string, programName: string) {
  const raw = String(value || "").trim();
  if (raw === "本科" || raw === "博士" || raw === "硕士") {
    return raw;
  }

  if (/(^|\s)phd(\s|$)|doctor|doctoral/i.test(programName)) {
    return "博士";
  }

  if (/(^|\s)ba(\s|$)|(^|\s)bs(\s|$)|(^|\s)bsc(\s|$)|undergraduate|bachelor/i.test(programName)) {
    return "本科";
  }

  return "硕士";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((item) => normalizeWhitespace(item)).filter(Boolean)));
}

function inferDiscipline(params: {
  major: string;
  specialization: string;
  title: string;
  snippet: string;
  link: string;
  pageTitle?: string;
}) {
  const specializationMajor = params.specialization
    ? SPECIALIZATION_TO_MAJOR[params.specialization] || ""
    : "";
  const searchText = normalizeText(
    [params.title, params.snippet, params.link, params.pageTitle].join(" ")
  );
  const tokenSet = tokenizeText(searchText);
  const scores = new Map<string, number>();

  const addScore = (major: string, score: number) => {
    if (!major || score <= 0) return;
    scores.set(major, (scores.get(major) ?? 0) + score);
  };

  if (params.major) {
    addScore(params.major, 4);
  }
  if (specializationMajor) {
    addScore(specializationMajor, 6);
  }

  const scoreAliases = (
    major: string,
    aliases: string[],
    points: { phrase: number; token: number }
  ) => {
    aliases.forEach((alias) => {
      if (matchNormalizedKeyword(searchText, tokenSet, alias)) {
        addScore(major, normalizeText(alias).includes(" ") ? points.phrase : points.token);
      }
    });
  };

  Object.entries(MAJOR_QUERY_ALIASES).forEach(([major, aliases]) => {
    scoreAliases(major, [major, ...aliases], { phrase: 6, token: 3 });
  });
  Object.entries(MAJOR_FAMILIES).forEach(([major, aliases]) => {
    scoreAliases(major, aliases, { phrase: 4, token: 2 });
  });
  Object.entries(DISCIPLINE_EXTRA_HINTS).forEach(([major, aliases]) => {
    scoreAliases(major, aliases, { phrase: 5, token: 3 });
  });
  Object.entries(SPECIALIZATION_QUERY_ALIASES).forEach(([specialization, aliases]) => {
    const mappedMajor = SPECIALIZATION_TO_MAJOR[specialization];
    if (!mappedMajor) return;
    scoreAliases(mappedMajor, [specialization, ...aliases], { phrase: 5, token: 3 });
  });

  const [bestMajor = "", bestScore = 0] = [...scores.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return left[0].localeCompare(right[0], "zh-CN");
  })[0] ?? [];

  return bestScore > 0 ? bestMajor : specializationMajor || params.major || "";
}

function truncateSummary(value: string, limit = 220) {
  const text = normalizeWhitespace(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function buildProgramSummary(params: {
  schoolName: string;
  snippet: string;
}) {
  if (params.snippet) {
    return truncateSummary(params.snippet);
  }

  return `${params.schoolName} 官方课程页候选已人工导入，待后续继续补充课程与申请要求摘要。`;
}

function inferUniversityByHost(
  universities: StudyAbroadCatalogUniversity[],
  link: string
) {
  const host = cleanDomain(extractHost(link));
  if (!host) return null;

  return (
    universities.find((item) =>
      hostMatchesDomain(host, cleanDomain(item.websiteDomain || item.officialWebsite))
    ) ?? null
  );
}

async function readCandidatePageMetadata(link: string) {
  if (!/^https?:\/\//i.test(String(link || "")) || isPdfLink(link)) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(link, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return null;
    }

    const html = await response.text();
    const pageTitle =
      normalizeWhitespace((html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || "") || "";
    const siteName =
      normalizeWhitespace(
        (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) ||
          [])[1] || ""
      ) || "";

    return {
      finalUrl: response.url || link,
      pageTitle,
      siteName,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUniversityId(name: string, country: string) {
  return slugify(`${name}-${country || "global"}`) || randomUUID().slice(0, 8);
}

function buildProgramId(programs: StudyAbroadCatalogProgram[], params: {
  schoolName: string;
  programName: string;
  degree: string;
}) {
  const baseId =
    slugify(`${params.schoolName}-${params.programName}-${params.degree}`) ||
    slugify(`${params.schoolName}-${params.programName}`) ||
    randomUUID().slice(0, 8);
  let nextId = baseId;
  let suffix = 2;

  while (programs.some((item) => item.id === nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }

  return nextId;
}

export async function importStudyAbroadReviewCandidate(params: {
  entryId: string;
  candidateLink: string;
  allowMetadataFetch?: boolean;
}) {
  const entryId = String(params.entryId ?? "").trim();
  const candidateLink = normalizeLink(params.candidateLink);
  const allowMetadataFetch = params.allowMetadataFetch !== false;

  if (!entryId || !candidateLink) {
    return {
      ok: false,
      created: false,
      alreadyExists: false,
      program: null,
      message: "缺少要导入的候选链接。",
    };
  }

  if (isPdfLink(candidateLink)) {
    return {
      ok: false,
      created: false,
      alreadyExists: false,
      program: null,
      message: "PDF 候选建议先人工核对，当前暂不支持一键导入正式项目。",
    };
  }

  const queue = await readStudyAbroadReviewQueue();
  const entry = queue.find((item) => item.id === entryId);
  if (!entry) {
    return {
      ok: false,
      created: false,
      alreadyExists: false,
      program: null,
      message: "这条候选任务不存在，可能已经被处理。",
    };
  }

  const candidate = entry.candidates.find(
    (item) => normalizeLink(item.link) === candidateLink
  );
  if (!candidate) {
    return {
      ok: false,
      created: false,
      alreadyExists: false,
      program: null,
      message: "这条候选链接不在当前任务里。",
    };
  }

  const [universities, programs] = await Promise.all([
    readStudyAbroadCatalogUniversities(),
    readStudyAbroadCatalogPrograms(),
  ]);

  const existingByUrl = programs.find((program) =>
    [program.overviewUrl, program.admissionsUrl, program.tuitionUrl]
      .map(normalizeLink)
      .includes(candidateLink)
  );
  if (existingByUrl) {
    return {
      ok: true,
      created: false,
      alreadyExists: true,
      program: existingByUrl,
      message: `这条候选已经在正式项目库里：${existingByUrl.schoolName} / ${existingByUrl.programName}。`,
    };
  }

  const matchedUniversity = inferUniversityByHost(universities, candidateLink);
  const metadata =
    matchedUniversity || !allowMetadataFetch ? null : await readCandidatePageMetadata(candidateLink);
  const inferredSchoolName =
    matchedUniversity?.name ||
    metadata?.siteName ||
    extractSchoolNameFromTitle(metadata?.pageTitle || "");

  if (!inferredSchoolName) {
    return {
      ok: false,
      created: false,
      alreadyExists: false,
      program: null,
      message: allowMetadataFetch
        ? "暂时无法从候选链接稳定识别学校名称，建议先人工核对后再入库。"
        : "批量导入已跳过需要联网识别学校名称的候选，建议打开官网核对后单条导入。",
    };
  }

  const university =
    matchedUniversity ??
    ({
      id: buildUniversityId(inferredSchoolName, entry.country || ""),
      name: inferredSchoolName,
      nameZh: getStudyAbroadUniversityNameZh(inferredSchoolName),
      country: entry.country || "",
      city: "",
      stateOrProvince: "",
      officialWebsite: (() => {
        try {
          return new URL(metadata?.finalUrl || candidateLink).origin;
        } catch {
          return "";
        }
      })(),
      websiteDomain: cleanDomain(extractHost(metadata?.finalUrl || candidateLink)),
      qsRank: null,
      qsRankingYear: null,
      rankingSource: "",
      sourceIds: [REVIEW_IMPORT_SOURCE_ID],
      updatedAt: new Date().toISOString().slice(0, 10),
    } satisfies StudyAbroadCatalogUniversity);

  const nextUniversities = matchedUniversity
    ? universities
    : [...universities, university];
  const programName = extractProgramName(candidate.title, metadata?.pageTitle);
  const degree = normalizeDegree(entry.degree, programName);
  const discipline = inferDiscipline({
    major: entry.major,
    specialization: entry.specialization,
    title: candidate.title,
    snippet: candidate.snippet,
    link: candidateLink,
    pageTitle: metadata?.pageTitle,
  });

  const existingByName = programs.find(
    (program) =>
      program.universityId === university.id &&
      program.degree === degree &&
      normalizeText(program.programName) === normalizeText(programName)
  );
  if (existingByName) {
    return {
      ok: true,
      created: false,
      alreadyExists: true,
      program: existingByName,
      message: `正式项目库里已经有这条项目：${existingByName.schoolName} / ${existingByName.programName}。`,
    };
  }

  const nextProgram = {
    id: buildProgramId(programs, {
      schoolName: university.name,
      programName,
      degree,
    }),
    universityId: university.id,
    schoolName: university.name,
    schoolNameZh: university.nameZh || getStudyAbroadUniversityNameZh(university.name),
    country: university.country || entry.country || "",
    city: university.city || "",
    stateOrProvince: university.stateOrProvince || "",
    programName,
    degree: degree as "本科" | "硕士" | "博士",
    discipline,
    summary: buildProgramSummary({
      schoolName: university.name,
      snippet: candidate.snippet,
    }),
    duration: "",
    intake: "",
    tuitionAmount: "",
    tuitionCurrency: "",
    tuitionNotes: "",
    overviewUrl: candidateLink,
    admissionsUrl: candidateLink,
    tuitionUrl: "",
    keywords: uniqueStrings([
      entry.major,
      entry.specialization,
      discipline,
      programName,
      candidate.title,
    ]),
    tags: uniqueStrings([
      university.country || entry.country,
      discipline,
      degree,
      "候选导入",
    ]),
    sourceIds: [REVIEW_IMPORT_SOURCE_ID],
    checkedAt: new Date().toISOString().slice(0, 10),
    priority: 72,
    admissionsSnapshot: null,
  } satisfies StudyAbroadCatalogProgram;

  const nextPrograms = [...programs, nextProgram];

  await Promise.all([
    matchedUniversity
      ? Promise.resolve(universities)
      : writeStudyAbroadCatalogUniversities(nextUniversities),
    writeStudyAbroadCatalogPrograms(nextPrograms),
  ]);

  return {
    ok: true,
    created: true,
    alreadyExists: false,
    program: nextProgram,
    message: `已把候选官网页导入正式项目库：${nextProgram.schoolName} / ${nextProgram.programName}。`,
  };
}

export async function importStudyAbroadReviewCandidatesByCredibility(params: {
  entryId: string;
  credibilityMode: "high" | "high-medium" | "all";
  maxCandidates?: number;
}) {
  const entryId = String(params.entryId ?? "").trim();
  const credibilityMode =
    params.credibilityMode === "high" ||
    params.credibilityMode === "high-medium" ||
    params.credibilityMode === "all"
      ? params.credibilityMode
      : "high";
  const maxCandidates = Math.min(
    MAX_BATCH_IMPORT_LIMIT,
    Math.max(1, Math.floor(Number(params.maxCandidates) || DEFAULT_BATCH_IMPORT_LIMIT))
  );

  if (!entryId) {
    return {
      ok: false,
      processedCount: 0,
      createdCount: 0,
      alreadyExistsCount: 0,
      skippedBlockedCount: 0,
      skippedPdfCount: 0,
      failedCount: 0,
      message: "缺少候选任务 ID，暂时无法批量导入。",
    };
  }

  const [queue, blocklist, programLinkIndex] = await Promise.all([
    readStudyAbroadReviewQueue(),
    readStudyAbroadSearchBlocklist(),
    readStudyAbroadCatalogProgramLinkIndex(),
  ]);
  const entry = queue.find((item) => item.id === entryId);

  if (!entry) {
    return {
      ok: false,
      processedCount: 0,
      createdCount: 0,
      alreadyExistsCount: 0,
      skippedBlockedCount: 0,
      skippedPdfCount: 0,
      failedCount: 0,
      message: "这条候选任务不存在，可能已经被处理。",
    };
  }

  const importedLinkSet = new Set(
    programLinkIndex.map((item) => normalizeLink(item.link)).filter(Boolean)
  );
  const matchingCandidates = [...entry.candidates]
    .filter((candidate) => matchesCredibilityMode(candidate.credibilityLevel, credibilityMode))
    .sort(compareCandidatesForBatchImport);
  const eligibleCandidates: typeof matchingCandidates = [];

  let alreadyExistsCount = 0;
  let skippedBlockedCount = 0;
  let skippedPdfCount = 0;

  for (const candidate of matchingCandidates) {
    const normalizedCandidateLink = normalizeLink(candidate.link);

    if (isBlockedStudyAbroadCandidate(candidate, blocklist)) {
      skippedBlockedCount += 1;
      continue;
    }

    if (isPdfLink(candidate.link)) {
      skippedPdfCount += 1;
      continue;
    }

    if (importedLinkSet.has(normalizedCandidateLink)) {
      alreadyExistsCount += 1;
      continue;
    }

    eligibleCandidates.push(candidate);
  }

  if (!matchingCandidates.length) {
    return {
      ok: true,
      processedCount: 0,
      createdCount: 0,
      alreadyExistsCount: 0,
      skippedBlockedCount: 0,
      skippedPdfCount: 0,
      failedCount: 0,
      message: `当前没有符合“${describeCredibilityMode(credibilityMode)}”条件的候选可批量导入。`,
    };
  }

  if (!eligibleCandidates.length) {
    const processedCount = alreadyExistsCount + skippedBlockedCount + skippedPdfCount;

    return {
      ok: true,
      processedCount,
      createdCount: 0,
      alreadyExistsCount,
      skippedBlockedCount,
      skippedPdfCount,
      failedCount: 0,
      remainingCount: 0,
      limitReached: false,
      message: [
        `当前没有新的${describeCredibilityMode(credibilityMode)}候选需要导入。`,
        alreadyExistsCount ? `已在正式库 ${alreadyExistsCount} 条` : "",
        skippedBlockedCount ? `跳过规避来源 ${skippedBlockedCount} 条` : "",
        skippedPdfCount ? `跳过 PDF ${skippedPdfCount} 条` : "",
      ]
        .filter(Boolean)
        .join("，"),
    };
  }

  let createdCount = 0;
  let failedCount = 0;
  let attemptedImportCount = 0;
  let timeBudgetReached = false;
  const startedAt = Date.now();

  for (const candidate of eligibleCandidates.slice(0, maxCandidates)) {
    if (Date.now() - startedAt > BATCH_IMPORT_TIME_BUDGET_MS) {
      timeBudgetReached = true;
      break;
    }

    const result = await importStudyAbroadReviewCandidate({
      entryId,
      candidateLink: candidate.link,
      allowMetadataFetch: false,
    });
    attemptedImportCount += 1;

    if (result.created) {
      createdCount += 1;
    } else if (result.alreadyExists) {
      alreadyExistsCount += 1;
    } else {
      failedCount += 1;
    }
  }

  const remainingCount = Math.max(0, eligibleCandidates.length - attemptedImportCount);
  const processedCount =
    createdCount +
    alreadyExistsCount +
    skippedBlockedCount +
    skippedPdfCount +
    failedCount;

  return {
    ok: processedCount > 0,
    processedCount,
    createdCount,
    alreadyExistsCount,
    skippedBlockedCount,
    skippedPdfCount,
    failedCount,
    message: [
      `已批量处理 ${processedCount} 条${describeCredibilityMode(credibilityMode)}候选。`,
      createdCount ? `新导入 ${createdCount} 条` : "",
      alreadyExistsCount ? `已在正式库 ${alreadyExistsCount} 条` : "",
      skippedBlockedCount ? `跳过规避来源 ${skippedBlockedCount} 条` : "",
      skippedPdfCount ? `跳过 PDF ${skippedPdfCount} 条` : "",
      failedCount ? `失败 ${failedCount} 条` : "",
      remainingCount
        ? `仍有 ${remainingCount} 条待分批导入，请刷新后继续点击`
        : "",
      timeBudgetReached ? "本次已接近服务器超时保护，已自动暂停" : "",
    ]
      .filter(Boolean)
      .join("，"),
    remainingCount,
    limitReached: remainingCount > 0 || timeBudgetReached,
  };
}

function matchesCredibilityMode(
  value: "high" | "medium" | "watch" | undefined,
  mode: "high" | "high-medium" | "all"
) {
  if (mode === "all") return true;
  if (mode === "high-medium") return value === "high" || value === "medium";
  return value === "high";
}

function compareCandidatesForBatchImport(
  left: {
    credibilityLevel?: "high" | "medium" | "watch";
    score?: number;
    authorityScore?: number;
    rerankScore?: number;
    title?: string;
  },
  right: {
    credibilityLevel?: "high" | "medium" | "watch";
    score?: number;
    authorityScore?: number;
    rerankScore?: number;
    title?: string;
  }
) {
  return (
    credibilityPriority(right.credibilityLevel) - credibilityPriority(left.credibilityLevel) ||
    Number(right.score ?? 0) - Number(left.score ?? 0) ||
    Number(right.authorityScore ?? 0) - Number(left.authorityScore ?? 0) ||
    Number(right.rerankScore ?? 0) - Number(left.rerankScore ?? 0) ||
    String(left.title || "").localeCompare(String(right.title || ""), "zh-CN")
  );
}

function credibilityPriority(value?: "high" | "medium" | "watch") {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function describeCredibilityMode(mode: "high" | "high-medium" | "all") {
  switch (mode) {
    case "high-medium":
      return "高+中可信";
    case "all":
      return "全部";
    default:
      return "高可信";
  }
}
