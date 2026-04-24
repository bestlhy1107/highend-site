import {
  COUNTRY_QUERY_ALIASES,
  DEGREE_QUERY_ALIASES,
  MAJOR_QUERY_ALIASES,
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

const BAIDU_SEARCH_ENDPOINT =
  "https://qianfan.baidubce.com/v2/ai_search/chat/completions";
const SEARCH_TIMEOUT_MS = 4500;
const BAIDU_DEFAULT_MODEL = "ernie-4.5-turbo-32k";
const BAIDU_APPBUILDER_API_KEY =
  import.meta.env.BAIDU_APPBUILDER_API_KEY ||
  import.meta.env.BAIDU_SEARCH_API_KEY ||
  process.env.BAIDU_APPBUILDER_API_KEY ||
  process.env.BAIDU_SEARCH_API_KEY ||
  "";
const BAIDU_SEARCH_MODEL =
  import.meta.env.BAIDU_SEARCH_MODEL ||
  process.env.BAIDU_SEARCH_MODEL ||
  BAIDU_DEFAULT_MODEL;

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

function expandQueryAliases(
  rawValue: string,
  aliasGroups: Record<string, string[]>,
  fallback: string[]
) {
  const value = normalizeText(rawValue);
  if (!value) return fallback;

  const expanded = new Set<string>(fallback.filter(Boolean));

  Object.entries(aliasGroups).forEach(([label, aliases]) => {
    const normalizedLabel = normalizeText(label);
    const hit =
      value.includes(normalizedLabel) ||
      aliases.some((alias) => value.includes(normalizeText(alias)));

    if (hit) {
      expanded.add(label);
      aliases.forEach((alias) => expanded.add(alias));
    }
  });

  expanded.add(rawValue);
  return Array.from(expanded).filter(Boolean);
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
      return `已返回 ${verifiedCount} 条已核验官方项目。当前站点未配置百度智能搜索 API，所以不会实时补抓新院校。`;
    }

    return `已返回 ${verifiedCount} 条已核验官方项目。`;
  }

  if (!expansionEnabled) {
    return "当前项目库里没有完全匹配结果，且站点还未配置百度智能搜索 API。建议先放宽专业词，或补充百度 AppBuilder API Key。";
  }

  if (pendingReviewCount) {
    return `项目库里暂时没有完全匹配结果，但已抓到 ${pendingReviewCount} 条候选官网页，后台核验后可补入结果池。`;
  }

  return "当前没有匹配到已核验项目，后台也没有抓到足够可靠的候选官网页。建议先放宽国家或专业方向。";
}

function canUseExternalSearch() {
  return Boolean(getBaiduSearchApiKey());
}

async function searchExternalOfficialCandidates(
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
  const queries = buildExternalQueries(query);
  const candidates: SearchWebCandidate[] = [];
  const baiduApiKey = getBaiduSearchApiKey();

  if (baiduApiKey) {
    for (const item of queries) {
      candidates.push(...(await searchBaiduCandidates(item, baiduApiKey)));
    }
  }

  return dedupeCandidates(candidates).slice(0, 12);
}

function buildExternalQueries(query: ReturnType<typeof normalizeStudyAbroadQuery>) {
  const majorAliases = expandQueryAliases(
    query.major,
    MAJOR_QUERY_ALIASES,
    [query.major || "研究生项目"]
  ).slice(0, 4);
  const locationAliases = expandQueryAliases(
    query.country,
    COUNTRY_QUERY_ALIASES,
    [query.country || "大学"]
  ).slice(0, 4);
  const degreeAliases = expandQueryAliases(
    query.degree,
    DEGREE_QUERY_ALIASES,
    [query.degree || "硕士"]
  ).slice(0, 4);

  const chineseLocation = locationAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || locationAliases[0];
  const englishLocation = locationAliases.find((item) => /[a-z]/i.test(item)) || locationAliases[0];
  const chineseMajor = majorAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || majorAliases[0];
  const englishMajor = majorAliases.find((item) => /[a-z]/i.test(item)) || majorAliases[0];
  const chineseDegree = degreeAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || degreeAliases[0];
  const englishDegree = degreeAliases.find((item) => /[a-z]/i.test(item)) || degreeAliases[0];

  const phrases = [
    `${chineseLocation} ${chineseMajor} ${chineseDegree} 官网 招生 简介 申请 条件`,
    `${englishLocation} ${englishMajor} ${englishDegree} official admissions program overview university website`,
    `${englishLocation} ${englishMajor} ${englishDegree} graduate admissions official site`,
  ];

  return Array.from(new Set(phrases.filter(Boolean)));
}

async function searchBaiduCandidates(searchQuery: string, apiKey: string) {
  const response = await fetchJsonWithTimeout(BAIDU_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Appbuilder-Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: searchQuery,
        },
      ],
      stream: false,
      model: BAIDU_SEARCH_MODEL,
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: 8 }],
      enable_corner_markers: false,
      enable_deep_search: false,
      enable_followup_queries: false,
      search_mode: "auto",
      enable_web_page_safety: true,
    }),
  });

  const items = Array.isArray(response?.references) ? response.references : [];

  return items
    .filter((item) => item?.type === "web")
    .map((item) => ({
      title: String(item.title ?? "").trim(),
      link: String(item.url ?? "").trim(),
      displayLink: String(item.website ?? item.web_anchor ?? "").trim(),
      snippet: String(item.content ?? "").trim(),
      provider: "Baidu AI Search",
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

function getBaiduSearchApiKey() {
  return BAIDU_APPBUILDER_API_KEY.trim();
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
