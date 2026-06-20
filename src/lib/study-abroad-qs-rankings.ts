import { readFileSync } from "node:fs";
import { dataFilePath } from "./json-file-store";

export type StudyAbroadQsRanking = {
  rank: number;
  year: number;
  source: string;
  sourceUrl: string;
};

type QsRankingEntry = {
  name?: string;
  rank?: number;
  year?: number;
  source?: string;
  sourceUrl?: string;
  country?: string;
  city?: string;
  contentPath?: string;
};

type QsRankingPayload = {
  source?: string;
  sourceUrl?: string;
  year?: number;
  items?: QsRankingEntry[];
};

const QS_RANKINGS_FILE = "qs-world-university-rankings-2027.json";
const DEFAULT_QS_YEAR = 2027;
const DEFAULT_QS_SOURCE = "QS World University Rankings 2027";
const DEFAULT_QS_SOURCE_URL = "https://www.topuniversities.com/world-university-rankings";

const MANUAL_NAME_ALIASES: Record<string, string[]> = {
  "university college london": ["ucl"],
  "university college london university of london": ["ucl"],
  "london school of economics and political science university of london": [
    "london school of economics and political science",
  ],
  "unsw sydney": ["university of new south wales"],
  "the university of new south wales": ["university of new south wales"],
  "massachusetts institute of technology": ["massachusetts institute of technology"],
  "pennsylvania state university main campus": ["pennsylvania state university"],
  "the pennsylvania state university": ["pennsylvania state university"],
  "university of washington seattle campus": ["university of washington"],
  "purdue university main campus": ["purdue university"],
  "texas a m university college station": ["texas a m university"],
  "arizona state university campus immersion": ["arizona state university"],
  "ohio state university main campus": ["ohio state university"],
  "the ohio state university": ["ohio state university"],
  "university of minnesota twin cities": ["university of minnesota"],
  "rutgers university new brunswick": ["rutgers university new brunswick"],
  "university of california berkeley": ["university of california berkeley"],
  "university of california los angeles": ["university of california los angeles"],
  "university of california san diego": ["university of california san diego"],
  "university of california davis": ["university of california davis"],
  "university of california santa barbara": ["university of california santa barbara"],
  "university of illinois urbana champaign": ["university of illinois urbana champaign"],
  "georgia institute of technology main campus": ["georgia institute of technology"],
  "university of north carolina at chapel hill": ["university of north carolina chapel hill"],
  "virginia polytechnic institute and state university": [
    "virginia polytechnic institute and state university",
    "virginia tech",
  ],
};

const DOMAIN_NAME_ALIASES: Record<string, string> = {
  "imperial.ac.uk": "imperial college london",
  "www.imperial.ac.uk": "imperial college london",
  "ucl.ac.uk": "ucl",
  "www.ucl.ac.uk": "ucl",
  "lse.ac.uk": "london school of economics and political science",
  "www.lse.ac.uk": "london school of economics and political science",
  "manchester.ac.uk": "university of manchester",
  "www.manchester.ac.uk": "university of manchester",
  "warwick.ac.uk": "university of warwick",
  "www.warwick.ac.uk": "university of warwick",
  "bristol.ac.uk": "university of bristol",
  "www.bristol.ac.uk": "university of bristol",
  "mit.edu": "massachusetts institute of technology",
  "web.mit.edu": "massachusetts institute of technology",
  "berkeley.edu": "university of california berkeley",
  "www.berkeley.edu": "university of california berkeley",
  "ucla.edu": "university of california los angeles",
  "www.ucla.edu": "university of california los angeles",
  "asu.edu": "arizona state university",
  "www.asu.edu": "arizona state university",
};

let cachedRankingIndex: Map<string, StudyAbroadQsRanking> | null = null;

function normalizeQsLookupKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\|.*$/g, " ")
    .replace(/\s+-\s+.*$/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the)\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateKeysForName(value: string) {
  const normalized = normalizeQsLookupKey(value);
  const candidates = new Set<string>();
  const add = (item: string) => {
    const key = normalizeQsLookupKey(item);
    if (key) candidates.add(key);
  };

  add(value);
  add(normalized);
  add(normalized.replace(/\buniversity of london$/, ""));
  add(normalized.replace(/\bmain campus$/, ""));
  add(normalized.replace(/\bcampus immersion$/, ""));
  add(normalized.replace(/\bseattle campus$/, ""));
  add(normalized.replace(/\bcollege station$/, ""));
  add(normalized.replace(/\bann arbor$/, ""));

  for (const candidate of Array.from(candidates)) {
    for (const alias of MANUAL_NAME_ALIASES[candidate] ?? []) {
      add(alias);
    }
  }

  return Array.from(candidates).filter(Boolean);
}

function addRankingVariant(
  index: Map<string, StudyAbroadQsRanking>,
  key: string,
  ranking: StudyAbroadQsRanking
) {
  const normalizedKey = normalizeQsLookupKey(key);
  if (!normalizedKey) return;

  const existing = index.get(normalizedKey);
  if (!existing || ranking.rank < existing.rank) {
    index.set(normalizedKey, ranking);
  }
}

function loadRankingIndex() {
  if (cachedRankingIndex) return cachedRankingIndex;

  const index = new Map<string, StudyAbroadQsRanking>();
  try {
    const payload = JSON.parse(
      readFileSync(dataFilePath(QS_RANKINGS_FILE), "utf8")
    ) as QsRankingPayload | QsRankingEntry[];
    const items = Array.isArray(payload) ? payload : payload.items ?? [];
    const payloadSource = Array.isArray(payload) ? DEFAULT_QS_SOURCE : payload.source;
    const payloadSourceUrl = Array.isArray(payload) ? DEFAULT_QS_SOURCE_URL : payload.sourceUrl;
    const payloadYear = Array.isArray(payload) ? DEFAULT_QS_YEAR : payload.year;

    for (const item of items) {
      const rank = Number(item.rank);
      const name = String(item.name ?? "").trim();
      if (!name || !Number.isFinite(rank) || rank <= 0) continue;

      const ranking = {
        rank,
        year: Number(item.year ?? payloadYear ?? DEFAULT_QS_YEAR),
        source: String(item.source ?? payloadSource ?? DEFAULT_QS_SOURCE),
        sourceUrl: String(item.sourceUrl ?? payloadSourceUrl ?? DEFAULT_QS_SOURCE_URL),
      };

      for (const key of candidateKeysForName(name)) {
        addRankingVariant(index, key, ranking);
      }
    }
  } catch {
    cachedRankingIndex = index;
    return index;
  }

  cachedRankingIndex = index;
  return index;
}

function cleanDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "www.")
    .replace(/\/.*$/, "");
}

export function getStudyAbroadQsRanking(input: {
  name?: string;
  websiteDomain?: string;
}): StudyAbroadQsRanking | null {
  const index = loadRankingIndex();
  const candidateKeys = candidateKeysForName(String(input.name ?? ""));
  const domainAlias = DOMAIN_NAME_ALIASES[cleanDomain(String(input.websiteDomain ?? ""))];
  if (domainAlias) candidateKeys.push(...candidateKeysForName(domainAlias));

  for (const key of candidateKeys) {
    const ranking = index.get(key);
    if (ranking) return ranking;
  }

  return null;
}
