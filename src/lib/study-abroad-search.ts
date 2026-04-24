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
  candidateResults: StudyAbroadReviewCandidate[];
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  message: string;
};

type SearchWebCandidate = StudyAbroadReviewCandidate & {
  date?: string;
  authorityScore?: number;
  rerankScore?: number;
  score?: number;
};

const BAIDU_SEARCH_ENDPOINT =
  "https://qianfan.baidubce.com/v2/ai_search/web_search";
const SEARCH_TIMEOUT_MS = 4500;
const BAIDU_APPBUILDER_API_KEY =
  import.meta.env.BAIDU_APPBUILDER_API_KEY ||
  import.meta.env.BAIDU_SEARCH_API_KEY ||
  process.env.BAIDU_APPBUILDER_API_KEY ||
  process.env.BAIDU_SEARCH_API_KEY ||
  "";

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

const BLOCKED_WEBSITES = [
  "zhihu.com",
  "zhuanlan.zhihu.com",
  "xiaohongshu.com",
  "baijiahao.baidu.com",
  "sohu.com",
  "163.com",
  "sina.com.cn",
  "qq.com",
  "mp.weixin.qq.com",
  "thegradcafe.com",
  "reddit.com",
  "gter.net",
  "applysquare.com",
  "liuxue86.com",
  "xdf.cn",
  "gaodun.com",
  "yuloo.com",
  "jjl.cn",
  "coursera.org",
  "mba.com",
  "topsedu.com",
  "eduei.com",
  "jianshu.com",
  "douban.com",
];

const UNIVERSITY_HOST_WORDS = [
  "university",
  "college",
  "school",
  "institute",
  "polytechnic",
  "business",
];

const OFFICIAL_TEXT_HINTS = [
  "admissions",
  "admission",
  "apply",
  "application",
  "graduate",
  "master",
  "programme",
  "program",
  "prospective",
];

const LOW_QUALITY_TEXT_HINTS = [
  "排名",
  "攻略",
  "经验",
  "留学中介",
  "论坛",
  "问答",
  "百科",
  "news",
  "ranking",
  "forum",
  "blog",
  "知乎",
  "小红书",
];

const DEGREE_CONFLICT_HINTS: Record<string, string[]> = {
  硕士: [
    "phd",
    "doctor",
    "doctoral",
    "bachelor",
    "undergraduate",
    "minor",
    "major",
    "mba",
    "mpa",
    "certificate",
    "specialization",
    "concentration",
  ],
  MBA: ["phd", "doctor", "doctoral", "bachelor", "undergraduate"],
};

const MIN_CANDIDATE_SCORE = 42;
const MAX_CANDIDATE_RESULTS = 8;

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
  let candidateResults: SearchWebCandidate[] = [];

  if (shouldRunExternalSearch(query, verifiedResults) && expansionEnabled) {
    expansionAttempted = true;
    const candidates = await searchExternalOfficialCandidates(query, verifiedResults);
    candidateResults = candidates;

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
    candidateResults,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    message: buildSearchMessage({
      query,
      verifiedCount: verifiedResults.length,
      candidateCount: candidateResults.length,
      expansionEnabled,
      expansionAttempted,
      pendingReviewCount,
    }),
  };
}

function shouldRunExternalSearch(
  query: ReturnType<typeof normalizeStudyAbroadQuery>,
  _verifiedResults: StudyAbroadProgram[]
) {
  return Boolean(query.major);
}

function buildSearchMessage(params: {
  query: ReturnType<typeof normalizeStudyAbroadQuery>;
  verifiedCount: number;
  candidateCount: number;
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
}) {
  const {
    verifiedCount,
    candidateCount,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
  } = params;

  if (verifiedCount) {
    if (candidateCount) {
      if (pendingReviewCount) {
        return `已返回 ${verifiedCount} 条已核验官方项目，并补充 ${candidateCount} 条全网候选官网页；候选结果也已同步到后台审核。`;
      }

      return `已返回 ${verifiedCount} 条已核验官方项目，并补充 ${candidateCount} 条全网候选官网页。候选页仅作扩展参考，不会替代正式推荐。`;
    }

    if (expansionAttempted) {
      return `已返回 ${verifiedCount} 条已核验官方项目；本轮全网搜索没有补充到更高质量的候选官网页。`;
    }

    if (!expansionEnabled) {
      return `已返回 ${verifiedCount} 条已核验官方项目。当前站点未配置百度搜索 API，所以不会实时补抓新院校。`;
    }

    return `已返回 ${verifiedCount} 条已核验官方项目。`;
  }

  if (!expansionEnabled) {
    return "当前项目库里没有完全匹配结果，且站点还未配置百度搜索 API。建议先放宽专业词，或补充百度 AppBuilder API Key。";
  }

  if (candidateCount) {
    if (pendingReviewCount) {
      return `当前没有命中已核验项目，但已从全网筛出 ${candidateCount} 条候选官网页，并已送入后台审核。`;
    }

    return `当前没有命中已核验项目，但已从全网筛出 ${candidateCount} 条候选官网页。建议先参考这些官网页，再由后台补入正式项目库。`;
  }

  return "当前没有匹配到已核验项目，后台也没有抓到足够可靠的候选官网页。建议先放宽国家或专业方向。";
}

function canUseExternalSearch() {
  return Boolean(getBaiduSearchApiKey());
}

async function searchExternalOfficialCandidates(
  query: ReturnType<typeof normalizeStudyAbroadQuery>,
  verifiedResults: StudyAbroadProgram[]
) {
  const queries = buildExternalQueries(query);
  const baiduApiKey = getBaiduSearchApiKey();
  const verifiedLinks = new Set(
    verifiedResults.flatMap((program) =>
      [program.overviewUrl, program.admissionsUrl].filter(Boolean)
    )
  );

  if (!baiduApiKey) {
    return [];
  }

  const resultSets = await Promise.all(
    queries.map((item) => searchBaiduCandidates(item, baiduApiKey, query))
  );

  return dedupeCandidates(resultSets.flat())
    .filter((candidate) => !verifiedLinks.has(candidate.link))
    .slice(0, MAX_CANDIDATE_RESULTS);
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
    `${chineseLocation} ${chineseMajor} ${chineseDegree} 官网 招生 项目 申请 条件`,
    `${englishLocation} ${englishMajor} ${englishDegree} university official admissions program`,
  ];

  return Array.from(new Set(phrases.filter(Boolean)));
}

async function searchBaiduCandidates(
  searchQuery: string,
  apiKey: string,
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
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
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: 20 }],
      block_websites: BLOCKED_WEBSITES,
    }),
  });

  const items = Array.isArray(response?.references) ? response.references : [];

  return items
    .filter((item) => item?.type === "web")
    .map((item) => {
      const candidate = {
      title: String(item.title ?? "").trim(),
      link: String(item.url ?? "").trim(),
      displayLink: String(item.website ?? item.web_anchor ?? "").trim(),
      snippet: String(item.content ?? "").trim(),
      provider: "Baidu Web Search",
      date: String(item.date ?? "").trim(),
      authorityScore: Number(item.authority_score ?? 0) || 0,
      rerankScore: Number(item.rerank_score ?? 0) || 0,
    } satisfies SearchWebCandidate;

      return {
        ...candidate,
        score: scoreCandidate(candidate, query),
      };
    })
    .filter((candidate) => candidate.score >= MIN_CANDIDATE_SCORE);
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

function hostLooksAcademic(host: string) {
  return UNIVERSITY_HOST_WORDS.some((item) => host.includes(item));
}

function guessCountryFromHost(host: string) {
  if (host.endsWith(".ac.uk")) return "英国";
  if (host.endsWith(".edu.au") || host.endsWith("unimelb.edu.au") || host.endsWith("unsw.edu.au")) {
    return "澳大利亚";
  }
  if (host.endsWith(".edu.sg") || host.endsWith("nus.edu.sg") || host.endsWith("smu.edu.sg")) {
    return "新加坡";
  }
  if (
    host.endsWith(".edu.hk") ||
    host.endsWith("hku.hk") ||
    host.endsWith("hkust.edu.hk") ||
    host.endsWith("cuhk.edu.hk")
  ) {
    return "中国香港";
  }
  if (host.endsWith(".edu")) return "美国";

  return "";
}

function textHasAlias(text: string, rawValue: string, aliasGroups: Record<string, string[]>) {
  if (!rawValue) return false;

  const tokenSet = tokenizeText(text);

  return expandQueryAliases(rawValue, aliasGroups, [rawValue])
    .some((item) => matchNormalizedKeyword(text, tokenSet, item));
}

function scoreCandidate(
  candidate: SearchWebCandidate,
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
  if (!candidate.link) return 0;

  let url: URL;
  try {
    url = new URL(candidate.link);
  } catch {
    return 0;
  }

  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const text = normalizeText(
    [candidate.title, candidate.displayLink, candidate.snippet, path].join(" ")
  );
  const guessedCountry = guessCountryFromHost(host);
  const countryMatched = textHasAlias(text, query.country, COUNTRY_QUERY_ALIASES);

  if (BLOCKED_WEBSITES.some((item) => host === item || host.endsWith(`.${item}`))) {
    return 0;
  }

  let score = 0;

  if (isOfficialCandidate(candidate)) {
    score += 34;
  } else if (hostLooksAcademic(host)) {
    score += 12;
  }

  if (OFFICIAL_TEXT_HINTS.some((item) => text.includes(item))) {
    score += 12;
  }

  const majorMatched = textHasAlias(text, query.major, MAJOR_QUERY_ALIASES);
  const degreeMatched = textHasAlias(text, query.degree, DEGREE_QUERY_ALIASES);

  if (query.major && !majorMatched) {
    return 0;
  }

  if (query.degree && DEGREE_CONFLICT_HINTS[query.degree]?.some((item) => text.includes(item))) {
    return 0;
  }

  if (majorMatched) {
    score += 22;
  }

  if (degreeMatched) {
    score += 9;
  } else if (query.degree) {
    score -= 14;

    if (query.degree === "硕士" && text.includes("graduate")) {
      score += 6;
    }
  }

  if (countryMatched) {
    score += 6;
  }

  if (query.country && guessedCountry && guessedCountry !== query.country) {
    return 0;
  }

  if (query.country && !guessedCountry && !countryMatched) {
    return 0;
  }

  if (LOW_QUALITY_TEXT_HINTS.some((item) => text.includes(normalizeText(item)))) {
    score -= 18;
  }

  score += Math.round((candidate.authorityScore ?? 0) * 14);
  score += Math.round((candidate.rerankScore ?? 0) * 12);

  return score;
}

function dedupeCandidates(items: SearchWebCandidate[]) {
  const map = new Map<string, SearchWebCandidate>();

  items.forEach((item) => {
    if (!item.link) return;
    const existing = map.get(item.link);

    if (!existing || (item.score ?? 0) > (existing.score ?? 0)) {
      map.set(item.link, item);
    }
  });

  return Array.from(map.values()).sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
}
