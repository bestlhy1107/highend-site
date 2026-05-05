import {
  readStudyAbroadCatalogUniversities,
  writeStudyAbroadCatalogUniversities,
  type StudyAbroadCatalogUniversity,
} from "./study-abroad-catalog-store";
import { STUDY_ABROAD_DATA_UPDATED_AT } from "./study-abroad-programs";
import { slugify } from "./text-fields";

type HipoUniversity = {
  alpha_two_code?: string;
  country?: string;
  name?: string;
  state_province?: string | null;
  "state-province"?: string | null;
  domains?: string[];
  web_pages?: string[];
};

const HIPO_WORLD_URL = "http://universities.hipolabs.com/search";
const HIPO_FETCH_TIMEOUT_MS = 45000;

const COUNTRY_OVERRIDES: Record<string, string> = {
  HK: "中国香港",
  MO: "中国澳门",
  TW: "中国台湾",
  GB: "英国",
  US: "美国",
};

const regionNames = new Intl.DisplayNames(["zh-CN"], { type: "region" });

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ");
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

function makeUniversityId(
  name: string,
  country: string,
  stateOrProvince: string,
  alpha2: string
) {
  return (
    slugify(`${name}-${alpha2 || country}-${stateOrProvince || "global"}`) ||
    crypto.randomUUID().slice(0, 8)
  );
}

function translateCountryName(rawCountry: string, alpha2: string) {
  const code = String(alpha2 || "").trim().toUpperCase();
  if (code && COUNTRY_OVERRIDES[code]) {
    return COUNTRY_OVERRIDES[code];
  }

  if (code) {
    const translated = regionNames.of(code);
    if (translated) {
      return translated;
    }
  }

  return String(rawCountry || "").trim();
}

function compareUniversities(
  left: StudyAbroadCatalogUniversity,
  right: StudyAbroadCatalogUniversity
) {
  return `${left.country}-${left.name}`.localeCompare(
    `${right.country}-${right.name}`,
    "zh-CN"
  );
}

function mergeSourceIds(current: string[], incoming: string[]) {
  return Array.from(new Set([...current, ...incoming].filter(Boolean)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HIPO_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Hipo universities request failed: ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJsonWithTimeout(url);
    } catch (error) {
      lastError = error;

      if (attempt === retries) {
        break;
      }

      await sleep(1200 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("全球学校底库拉取失败");
}

async function fetchGlobalHipoUniversities() {
  const raw = (await fetchWithRetry(HIPO_WORLD_URL)) as HipoUniversity[];

  return raw
    .map((item) => {
      const alpha2 = String(item.alpha_two_code || "").trim().toUpperCase();
      const rawCountry = String(item.country || "").trim();
      const country = translateCountryName(rawCountry, alpha2);
      const name = String(item.name || "").trim();
      const stateOrProvince = String(
        item["state-province"] ?? item.state_province ?? ""
      ).trim();
      const officialWebsite = withHttps(item.web_pages?.[0] || "");
      const websiteDomain = cleanDomain(item.domains?.[0] || websiteHost(officialWebsite));

      return {
        id: makeUniversityId(name, country, stateOrProvince, alpha2),
        name,
        country,
        city: "",
        stateOrProvince,
        officialWebsite,
        websiteDomain,
        qsRank: null,
        qsRankingYear: null,
        rankingSource: "",
        sourceIds: ["hipolabs-university-domains"],
        updatedAt: STUDY_ABROAD_DATA_UPDATED_AT,
      } satisfies StudyAbroadCatalogUniversity;
    })
    .filter((item) => item.name && item.country && item.websiteDomain);
}

function mergeGlobalUniversities(
  importedUniversities: StudyAbroadCatalogUniversity[],
  existingUniversities: StudyAbroadCatalogUniversity[]
) {
  const map = new Map<string, StudyAbroadCatalogUniversity>();
  const idByDomain = new Map<string, string>();
  const idByNameCountry = new Map<string, string>();

  existingUniversities.forEach((item) => {
    map.set(item.id, item);

    if (item.websiteDomain) {
      idByDomain.set(item.websiteDomain, item.id);
    }

    idByNameCountry.set(
      normalizeText(`${item.name}-${item.country}-${item.stateOrProvince || ""}`),
      item.id
    );
  });

  importedUniversities.forEach((item) => {
    if (item.country === "美国") {
      return;
    }

    const nameKey = normalizeText(`${item.name}-${item.country}-${item.stateOrProvince || ""}`);
    const existingId =
      (item.websiteDomain ? idByDomain.get(item.websiteDomain) : "") ||
      idByNameCountry.get(nameKey) ||
      "";

    const nextId = existingId || item.id;
    const current = map.get(nextId);

    const nextItem: StudyAbroadCatalogUniversity = {
      id: nextId,
      name: current?.name || item.name,
      nameZh: current?.nameZh || "",
      country: current?.country || item.country,
      city: current?.city || item.city || "",
      stateOrProvince: current?.stateOrProvince || item.stateOrProvince || "",
      officialWebsite: current?.officialWebsite || item.officialWebsite || "",
      websiteDomain: current?.websiteDomain || item.websiteDomain || "",
      qsRank: current?.qsRank ?? null,
      qsRankingYear: current?.qsRankingYear ?? null,
      rankingSource: current?.rankingSource ?? "",
      sourceIds: mergeSourceIds(current?.sourceIds ?? [], item.sourceIds),
      updatedAt: new Date().toISOString().slice(0, 10),
    };

    map.set(nextId, nextItem);

    if (nextItem.websiteDomain) {
      idByDomain.set(nextItem.websiteDomain, nextId);
    }

    idByNameCountry.set(nameKey, nextId);
  });

  return Array.from(map.values()).sort(compareUniversities);
}

export async function syncGlobalStudyAbroadUniversityCatalog() {
  const [existingUniversities, importedUniversities] = await Promise.all([
    readStudyAbroadCatalogUniversities(),
    fetchGlobalHipoUniversities(),
  ]);

  const nextUniversities = mergeGlobalUniversities(importedUniversities, existingUniversities);
  const savedUniversities = await writeStudyAbroadCatalogUniversities(nextUniversities);

  const countryCount = new Set(savedUniversities.map((item) => item.country).filter(Boolean)).size;
  const nonUsUniversityCount = savedUniversities.filter((item) => item.country !== "美国").length;

  return {
    ok: true,
    importedRecordCount: importedUniversities.length,
    totalUniversityCount: savedUniversities.length,
    nonUsUniversityCount,
    countryCount,
    message: `已同步全球学校底库：当前共 ${savedUniversities.length} 所学校，覆盖 ${countryCount} 个国家 / 地区；其中美国外学校 ${nonUsUniversityCount} 所。`,
  };
}
