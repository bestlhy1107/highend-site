import {
  MAJOR_FAMILIES,
  STUDY_ABROAD_PROGRAMS,
  type StudyAbroadProgram,
} from "./study-abroad-programs";
import {
  enqueueStudyAbroadReview,
  type StudyAbroadReviewCandidate,
} from "./study-abroad-review-queue";

export type StudyAbroadSearchInput = {
  country?: string;
  major?: string;
  degree?: string;
};

export type StudyAbroadSearchResult = {
  verifiedResults: StudyAbroadProgram[];
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  message: string;
};

type SearchWebCandidate = StudyAbroadReviewCandidate;

const GOOGLE_SEARCH_ENDPOINT = "https://www.googleapis.com/customsearch/v1";
const BING_SEARCH_ENDPOINT = "https://api.bing.microsoft.com/v7.0/search";
const SEARCH_TIMEOUT_MS = 4500;

const OFFICIAL_HOST_HINTS = [
  ".edu",
  ".ac.uk",
  ".edu.au",
  ".edu.sg",
  ".edu.hk",
  ".edu.cn",
  "utoronto.ca",
  "ubc.ca",
  "hku.hk",
  "hkust.edu.hk",
  "cuhk.edu.hk",
  "unimelb.edu.au",
  "unsw.edu.au",
  "ucl.ac.uk",
  "lse.ac.uk",
  "cmu.edu",
  "columbia.edu",
  "northwestern.edu",
  "nus.edu.sg",
  "smu.edu.sg",
];

const OFFICIAL_PATH_HINTS = [
  "admission",
  "apply",
  "application",
  "graduate",
  "master",
  "msc",
  "mba",
  "program",
  "programme",
  "prospective",
  "study",
  "course",
];

export function normalizeStudyAbroadQuery(input: StudyAbroadSearchInput) {
  return {
    country: String(input.country ?? "").trim(),
    major: String(input.major ?? "").trim(),
    degree: String(input.degree ?? "").trim(),
  };
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
  return new Set(
    normalizeText(value)
      .split(" ")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function matchNormalizedKeyword(
  searchText: string,
  tokenSet: Set<string>,
  rawKeyword: string
) {
  const keyword = normalizeText(rawKeyword);
  if (!keyword) return false;

  if (keyword.includes(" ") || keyword.length > 2) {
    return searchText.includes(keyword);
  }

  return tokenSet.has(keyword);
}

function expandQueryTokens(major: string) {
  const query = normalizeText(major);
  if (!query) return [];

  const expanded = new Set(query.split(" ").filter(Boolean));

  Object.entries(MAJOR_FAMILIES).forEach(([label, keywords]) => {
    const normalizedLabel = normalizeText(label);
    const hasFamilyMatch =
      query.includes(normalizedLabel) ||
      keywords.some((keyword) => query.includes(normalizeText(keyword)));

    if (hasFamilyMatch) {
      expanded.add(normalizedLabel);
      keywords.forEach((keyword) => expanded.add(normalizeText(keyword)));
    }
  });

  return Array.from(expanded);
}

export function searchVerifiedStudyAbroadPrograms(input: StudyAbroadSearchInput) {
  const query = normalizeStudyAbroadQuery(input);
  const queryTokens = expandQueryTokens(query.major);

  return STUDY_ABROAD_PROGRAMS.map((program) => {
    if (query.country && program.country !== query.country) {
      return null;
    }

    if (query.degree && program.degree !== query.degree) {
      return null;
    }

    const searchText = normalizeText(
      [
        program.schoolName,
        program.programName,
        program.discipline,
        program.summary,
        ...program.keywords,
        ...program.tags,
      ].join(" ")
    );
    const tokenSet = tokenizeText(searchText);

    let score = program.priority;

    if (query.major) {
      const rawQuery = normalizeText(query.major);
      let majorMatched = matchNormalizedKeyword(searchText, tokenSet, rawQuery);

      queryTokens.forEach((token) => {
        if (matchNormalizedKeyword(searchText, tokenSet, token)) {
          majorMatched = true;
          score += token.length > 2 ? 9 : 4;
        }
      });

      if (!majorMatched) {
        return null;
      }
    }

    if (query.country) score += 12;
    if (query.degree) score += 6;

    return { program, score };
  })
    .filter((item): item is { program: StudyAbroadProgram; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.program);
}

export async function searchStudyAbroadPrograms(
  input: StudyAbroadSearchInput
): Promise<StudyAbroadSearchResult> {
  const query = normalizeStudyAbroadQuery(input);
  const verifiedResults = searchVerifiedStudyAbroadPrograms(query).slice(0, 12);
  const expansionEnabled = canUseExternalSearch();
  let pendingReviewCount = 0;
  let expansionAttempted = false;

  if (shouldRunExternalSearch(query, verifiedResults) && expansionEnabled) {
    expansionAttempted = true;
    const candidates = await searchExternalOfficialCandidates(query);

    if (candidates.length) {
      const queued = await enqueueStudyAbroadReview({
        ...query,
        candidates,
      });

      if (queued.saved) {
        pendingReviewCount = candidates.length;
      }
    }
  }

  return {
    verifiedResults,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    message: buildSearchMessage({
      query,
      verifiedCount: verifiedResults.length,
      expansionEnabled,
      expansionAttempted,
      pendingReviewCount,
    }),
  };
}

function shouldRunExternalSearch(
  query: ReturnType<typeof normalizeStudyAbroadQuery>,
  verifiedResults: StudyAbroadProgram[]
) {
  return Boolean(query.major) && verifiedResults.length < 5;
}

function buildSearchMessage(params: {
  query: ReturnType<typeof normalizeStudyAbroadQuery>;
  verifiedCount: number;
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
}) {
  const { verifiedCount, expansionEnabled, expansionAttempted, pendingReviewCount } = params;

  if (verifiedCount) {
    if (pendingReviewCount) {
      return `先返回 ${verifiedCount} 条已核验官方项目；另外发现 ${pendingReviewCount} 条候选官网结果，已进入后台核验。`;
    }

    if (expansionAttempted) {
      return `先返回 ${verifiedCount} 条已核验官方项目；后台没有补充到更高质量的候选官网页。`;
    }

    if (!expansionEnabled) {
      return `已返回 ${verifiedCount} 条已核验官方项目。当前站点未配置全网扩搜 API，所以不会实时补抓新院校。`;
    }

    return `已返回 ${verifiedCount} 条已核验官方项目。`;
  }

  if (!expansionEnabled) {
    return "当前项目库里没有完全匹配结果，且站点还未配置 Google/Bing 官方搜索 API。建议先放宽专业词，或补充扩搜配置。";
  }

  if (pendingReviewCount) {
    return `项目库里暂时没有完全匹配结果，但已抓到 ${pendingReviewCount} 条候选官网页，后台核验后可补入结果池。`;
  }

  return "当前没有匹配到已核验项目，后台也没有抓到足够可靠的候选官网页。建议先放宽国家或专业方向。";
}

function canUseExternalSearch() {
  return Boolean(
    (process.env.GOOGLE_CUSTOM_SEARCH_API_KEY &&
      process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID) ||
      process.env.BING_SEARCH_API_KEY
  );
}

async function searchExternalOfficialCandidates(
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
  const queries = buildExternalQueries(query);
  const candidates: SearchWebCandidate[] = [];

  if (process.env.GOOGLE_CUSTOM_SEARCH_API_KEY && process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID) {
    for (const item of queries) {
      candidates.push(
        ...(await searchGoogleCandidates(item, {
          apiKey: process.env.GOOGLE_CUSTOM_SEARCH_API_KEY,
          engineId: process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID,
        }))
      );
    }
  } else if (process.env.BING_SEARCH_API_KEY) {
    for (const item of queries) {
      candidates.push(
        ...(await searchBingCandidates(item, process.env.BING_SEARCH_API_KEY))
      );
    }
  }

  return dedupeCandidates(candidates).slice(0, 12);
}

function buildExternalQueries(query: ReturnType<typeof normalizeStudyAbroadQuery>) {
  const major = query.major || "graduate program";
  const location = query.country || "university";
  const degree = query.degree || "master";

  const phrases = [
    `${location} ${major} ${degree} official admissions`,
    `${location} ${major} ${degree} site:edu OR site:ac.uk OR site:edu.au OR site:edu.sg OR site:edu.hk`,
  ];

  return Array.from(new Set(phrases));
}

async function searchGoogleCandidates(
  searchQuery: string,
  config: { apiKey: string; engineId: string }
) {
  const url = new URL(GOOGLE_SEARCH_ENDPOINT);
  url.searchParams.set("key", config.apiKey);
  url.searchParams.set("cx", config.engineId);
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("num", "8");

  const response = await fetchJsonWithTimeout(url.toString());
  const items = Array.isArray(response?.items) ? response.items : [];

  return items
    .map((item) => ({
      title: String(item.title ?? "").trim(),
      link: String(item.link ?? "").trim(),
      displayLink: String(item.displayLink ?? "").trim(),
      snippet: String(item.snippet ?? "").trim(),
      provider: "Google Programmable Search",
    }))
    .filter(isOfficialCandidate);
}

async function searchBingCandidates(searchQuery: string, apiKey: string) {
  const url = new URL(BING_SEARCH_ENDPOINT);
  url.searchParams.set("q", searchQuery);
  url.searchParams.set("count", "8");
  url.searchParams.set("responseFilter", "Webpages");

  const response = await fetchJsonWithTimeout(url.toString(), {
    headers: {
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });

  const items = Array.isArray(response?.webPages?.value)
    ? response.webPages.value
    : [];

  return items
    .map((item) => ({
      title: String(item.name ?? "").trim(),
      link: String(item.url ?? "").trim(),
      displayLink: String(item.displayUrl ?? "").trim(),
      snippet: String(item.snippet ?? "").trim(),
      provider: "Bing Web Search",
    }))
    .filter(isOfficialCandidate);
}

async function fetchJsonWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);

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
      throw new Error(`Search request failed: ${response.status}`);
    }

    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function isOfficialCandidate(candidate: SearchWebCandidate) {
  if (!candidate.link) return false;

  let url: URL;
  try {
    url = new URL(candidate.link);
  } catch {
    return false;
  }

  const host = url.hostname.toLowerCase();
  const path = `${url.pathname} ${candidate.title} ${candidate.snippet}`.toLowerCase();

  const officialHost = OFFICIAL_HOST_HINTS.some((hint) => host.endsWith(hint));
  const officialPath = OFFICIAL_PATH_HINTS.some((hint) => path.includes(hint));

  return officialHost && officialPath;
}

function dedupeCandidates(items: SearchWebCandidate[]) {
  const map = new Map<string, SearchWebCandidate>();

  items.forEach((item) => {
    if (!item.link) return;
    map.set(item.link, item);
  });

  return Array.from(map.values());
}
