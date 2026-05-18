import { randomUUID } from "node:crypto";
import {
  COUNTRY_QUERY_ALIASES,
  DEGREE_QUERY_ALIASES,
  MAJOR_QUERY_ALIASES,
  MAJOR_FAMILIES,
  SPECIALIZATION_QUERY_ALIASES,
  SPECIALIZATION_TO_MAJOR,
} from "./study-abroad-programs";
import {
  readStudyAbroadCatalogUniversities,
  readStudyAbroadFinderPrograms,
  type StudyAbroadFinderProgram,
} from "./study-abroad-catalog-store";
import {
  enqueueStudyAbroadReview,
  type StudyAbroadReviewCandidate,
} from "./study-abroad-review-queue";
import {
  isBlockedStudyAbroadCandidate,
  isBlockedStudyAbroadFinderProgram,
  readStudyAbroadSearchBlocklist,
  upsertStudyAbroadSearchAuditEntry,
  type StudyAbroadSearchAuditResult,
} from "./study-abroad-search-governance";
import { readStudyAbroadCachedAdmissionsInsights } from "./study-abroad-admissions";
import {
  buildStudyAbroadFitPreviewFromInsight,
  type StudyAbroadFitPreview,
} from "./study-abroad-fit";

export type StudyAbroadSearchInput = {
  searchSessionId?: string;
  freeText?: string;
  country?: string;
  major?: string;
  specialization?: string;
  degree?: string;
  budgetTier?: string;
  intake?: string;
  gpaProfile?: string;
  languageProfile?: string;
  fitMode?: string;
  snapshotQuality?: string;
  universityId?: string;
};

export type StudyAbroadResolvedQuery = {
  freeText: string;
  country: string;
  major: string;
  specialization: string;
  degree: string;
  budgetTier: string;
  intake: string;
  gpaProfile: string;
  languageProfile: string;
  fitMode: string;
  snapshotQuality: string;
  universityId: string;
};

export type StudyAbroadSearchResult = {
  searchSessionId: string;
  resolvedQuery: StudyAbroadResolvedQuery;
  verifiedResults: StudyAbroadFinderProgram[];
  totalVerifiedCount: number;
  displayedVerifiedCount: number;
  universityMatches: StudyAbroadUniversityMatch[];
  totalUniversityCount: number;
  candidateResults: StudyAbroadReviewCandidate[];
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  blockedResultCount: number;
  message: string;
};

export type StudyAbroadSearchExpansionResult = {
  searchSessionId: string;
  resolvedQuery: StudyAbroadResolvedQuery;
  candidateResults: StudyAbroadReviewCandidate[];
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  blockedResultCount: number;
  message: string;
};

export type StudyAbroadSearchRuntimeCheckResult = {
  status: ReturnType<typeof getStudyAbroadSearchRuntimeStatus>;
  probe: {
    attempted: boolean;
    ok: boolean;
    query: string;
    rawReferenceCount: number;
    candidateCount: number;
    message: string;
  };
};

export type StudyAbroadUniversityMatch = {
  universityId: string;
  schoolName: string;
  schoolNameZh: string;
  country: string;
  city: string;
  stateOrProvince: string;
  officialWebsite: string;
  qsRank: number | null;
  qsRankingYear: number | null;
  rankingSource: string;
  programCount: number;
  featuredScore: number;
  topDisciplines: string[];
  featuredPrograms: string[];
  tuitionProjectCount: number;
  tuitionMin: number | null;
  tuitionMax: number | null;
  tuitionCurrency: string;
};

type SearchWebCandidate = StudyAbroadReviewCandidate & {
  date?: string;
  authorityScore?: number;
  rerankScore?: number;
  score?: number;
};

type SearchExternalCandidatesResult = {
  candidates: SearchWebCandidate[];
  blockedCount: number;
};

const BAIDU_SEARCH_ENDPOINT =
  "https://qianfan.baidubce.com/v2/ai_search/web_search";
const SEARCH_TIMEOUT_MS = 5500;
const BAIDU_APPBUILDER_API_KEY =
  import.meta.env?.BAIDU_APPBUILDER_API_KEY ||
  import.meta.env?.BAIDU_SEARCH_API_KEY ||
  process.env.BAIDU_APPBUILDER_API_KEY ||
  process.env.BAIDU_SEARCH_API_KEY ||
  "";
const BAIDU_SEARCH_MODEL =
  import.meta.env?.BAIDU_SEARCH_MODEL ||
  process.env.BAIDU_SEARCH_MODEL ||
  "ernie-4.5-turbo-32k";
const QUERY_SUPPRESS_VALUE = "__none__";

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
  本科: [
    "master",
    "masters",
    "graduate",
    "msc",
    "mba",
    "phd",
    "doctor",
    "doctoral",
  ],
  硕士: [
    "phd",
    "doctor",
    "doctoral",
    "bachelor",
    "undergraduate",
    "minor",
    "major",
    "mpa",
    "certificate",
    "specialization",
    "concentration",
  ],
  博士: ["bachelor", "undergraduate", "master", "masters", "msc", "mba"],
};

const MIN_CANDIDATE_SCORE = 30;
const MAX_CANDIDATE_RESULTS = 36;
const MAX_REVIEW_QUEUE_CANDIDATES = 20;
const MAX_VERIFIED_RESULTS = 160;

function hasStructuredFitInput(query: ReturnType<typeof normalizeStudyAbroadQuery>) {
  return Boolean(query.gpaProfile || query.languageProfile);
}

function normalizeFitMode(value: string) {
  return value === "exclude-risk" || value === "match-only" ? value : "prefer";
}

function fitStatusWeight(status: StudyAbroadFitPreview["status"]) {
  if (status === "match") return 3;
  if (status === "review") return 2;
  return 1;
}

async function prioritizeVerifiedResultsByCachedFit(
  results: StudyAbroadFinderProgram[],
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
  const fitMode = normalizeFitMode(query.fitMode);

  if (!hasStructuredFitInput(query) || !results.length) {
    return {
      results,
      cachedFitCount: 0,
      fitMode,
      filteredByFitModeCount: 0,
      fitSummary: {
        match: 0,
        review: 0,
        risk: 0,
      },
    };
  }

  const previewMap = new Map<string, StudyAbroadFitPreview>();

  results.forEach((program) => {
    if (!program.admissionsSnapshot?.extractedAt) {
      return;
    }

    previewMap.set(
      program.id,
      buildStudyAbroadFitPreviewFromInsight(
        {
          programId: program.id,
          admissionsProfile: {
            gpaMin: program.admissionsSnapshot.gpaMin,
            gpaScale: program.admissionsSnapshot.gpaScale,
            ieltsMin: program.admissionsSnapshot.ieltsMin,
            toeflMin: program.admissionsSnapshot.toeflMin,
            duolingoMin: program.admissionsSnapshot.duolingoMin,
            pteMin: program.admissionsSnapshot.pteMin,
            greStatus: program.admissionsSnapshot.greStatus,
            gmatStatus: program.admissionsSnapshot.gmatStatus,
            workExperienceYears: program.admissionsSnapshot.workExperienceYears,
            academicSignals: [],
            languageSignals: [],
            testSignals: [],
          },
          extractionStatus: program.admissionsSnapshot.extractionStatus,
        },
        {
          gpaProfile: query.gpaProfile,
          languageProfile: query.languageProfile,
        }
      )
    );
  });

  const missingProgramIds = results
    .filter((program) => !previewMap.has(program.id))
    .map((program) => program.id);

  if (missingProgramIds.length) {
    const cachedInsights = await readStudyAbroadCachedAdmissionsInsights(missingProgramIds);
    cachedInsights.forEach((insight) => {
      previewMap.set(
        insight.programId,
        buildStudyAbroadFitPreviewFromInsight(insight, {
          gpaProfile: query.gpaProfile,
          languageProfile: query.languageProfile,
        })
      );
    });
  }

  if (!previewMap.size) {
    return {
      results,
      cachedFitCount: 0,
      fitMode,
      filteredByFitModeCount: 0,
      fitSummary: {
        match: 0,
        review: 0,
        risk: 0,
      },
    };
  }

  const fitSummary = {
    match: 0,
    review: 0,
    risk: 0,
  };

  previewMap.forEach((preview) => {
    fitSummary[preview.status] += 1;
  });

  const reordered = [...results].sort((left, right) => {
    const leftPreview = previewMap.get(left.id);
    const rightPreview = previewMap.get(right.id);
    const leftWeight = leftPreview ? fitStatusWeight(leftPreview.status) : 0;
    const rightWeight = rightPreview ? fitStatusWeight(rightPreview.status) : 0;

    if (leftWeight !== rightWeight) {
      return rightWeight - leftWeight;
    }

    if (leftPreview && rightPreview && leftPreview.status !== rightPreview.status) {
      return fitStatusWeight(rightPreview.status) - fitStatusWeight(leftPreview.status);
    }

    return 0;
  });

  const fitFiltered = reordered.filter((program) => {
    const preview = previewMap.get(program.id);

    if (fitMode === "exclude-risk") {
      return preview?.status !== "risk";
    }

    if (fitMode === "match-only") {
      return preview?.status === "match";
    }

    return true;
  });

  return {
    results: fitFiltered,
    cachedFitCount: previewMap.size,
    fitMode,
    filteredByFitModeCount: Math.max(0, reordered.length - fitFiltered.length),
    fitSummary,
  };
}

function resolveQueryOverride(rawValue: unknown) {
  const normalized = String(rawValue ?? "").trim();
  return {
    value: normalized === QUERY_SUPPRESS_VALUE ? "" : normalized,
    suppressed: normalized === QUERY_SUPPRESS_VALUE,
  };
}

export function normalizeStudyAbroadQuery(input: StudyAbroadSearchInput): StudyAbroadResolvedQuery {
  const freeText = String(input.freeText ?? "").trim();
  const inferred = inferStudyAbroadQueryFromFreeText(freeText);
  const countryOverride = resolveQueryOverride(input.country);
  const degreeOverride = resolveQueryOverride(input.degree);
  const majorOverride = resolveQueryOverride(input.major);
  const specializationOverride = resolveQueryOverride(input.specialization);
  const specialization = specializationOverride.suppressed
    ? ""
    : specializationOverride.value || inferred.specialization || "";
  const major = majorOverride.suppressed
    ? ""
    : majorOverride.value ||
      (specialization ? SPECIALIZATION_TO_MAJOR[specialization] || "" : "") ||
      inferred.major ||
      "";

  return {
    freeText,
    country: countryOverride.suppressed
      ? ""
      : countryOverride.value || inferred.country || "",
    major,
    specialization,
    degree: degreeOverride.suppressed ? "" : degreeOverride.value || inferred.degree || "",
    budgetTier: String(input.budgetTier ?? "").trim(),
    intake: String(input.intake ?? "").trim(),
    gpaProfile: String(input.gpaProfile ?? "").trim(),
    languageProfile: String(input.languageProfile ?? "").trim(),
    fitMode: String(input.fitMode ?? "").trim(),
    snapshotQuality: String(input.snapshotQuality ?? "").trim(),
    universityId: String(input.universityId ?? "").trim(),
  };
}

function createSearchSessionId(input: StudyAbroadSearchInput) {
  return String(input.searchSessionId ?? "").trim() || randomUUID();
}

function toAuditResultsFromVerifiedPrograms(
  programs: StudyAbroadFinderProgram[]
): StudyAbroadSearchAuditResult[] {
  return programs.map((program) => ({
    id: `verified:${program.id}`,
    source: "verified",
    label: `${program.schoolNameZh || program.schoolName} / ${program.programName}`,
    schoolName: program.schoolNameZh || program.schoolName,
    programName: program.programName,
    country: program.country,
    degree: program.degree,
    discipline: program.discipline,
    link: program.admissionsUrl || program.overviewUrl,
    displayLink: program.websiteDomain || program.officialWebsite,
    provider: "verified-catalog",
    programId: program.id,
  }));
}

function toAuditResultsFromCandidates(
  candidates: StudyAbroadReviewCandidate[]
): StudyAbroadSearchAuditResult[] {
  return candidates.map((candidate) => ({
    id: `candidate:${candidate.link}`,
    source: "candidate",
    label: candidate.title,
    schoolName: "",
    programName: candidate.title,
    country: "",
    degree: "",
    discipline: "",
    link: candidate.link,
    displayLink: candidate.displayLink,
    provider: candidate.provider,
    programId: "",
  }));
}

function hasStructuredSnapshot(program: StudyAbroadFinderProgram) {
  const snapshot = program.admissionsSnapshot;
  if (!snapshot?.extractedAt) return false;

  return Boolean(
    snapshot.gpaMin ||
      snapshot.ieltsMin ||
      snapshot.toeflMin ||
      snapshot.duolingoMin ||
      snapshot.pteMin ||
      snapshot.greStatus !== "unknown" ||
      snapshot.gmatStatus !== "unknown" ||
      snapshot.workExperienceYears
  );
}

function admissionsCoverageWeight(program: StudyAbroadFinderProgram) {
  const status = program.admissionsSnapshot?.extractionStatus;

  if (status === "ok") return 8;
  if (status === "partial") return 5;
  if (status === "unavailable" && program.admissionsSnapshot?.extractedAt) return 2;
  if (program.admissionsUrl) return 2;
  return 0;
}

function referenceDataWeight(program: StudyAbroadFinderProgram) {
  let score = 0;

  if (program.admissionsUrl) score += 2;

  const tuitionAmount = Number(program.tuitionAmount);
  if (Number.isFinite(tuitionAmount) && tuitionAmount > 0) {
    score += 2;
  }

  const qsRank = Number(program.qsRank);
  if (Number.isFinite(qsRank) && qsRank > 0) {
    score += qsRank <= 100 ? 3 : qsRank <= 200 ? 2 : 1;
  }

  if (program.checkedAt) {
    score += 1;
  }

  return score;
}

function consultationReadinessWeight(
  program: StudyAbroadFinderProgram,
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
  let score = 0;

  if (hasStructuredFitInput(query) && program.admissionsSnapshot?.extractedAt) {
    score += 4;
  }

  if (query.intake && program.intake) {
    score += 1;
  }

  if (query.budgetTier) {
    const tuitionAmount = Number(program.tuitionAmount);
    if (Number.isFinite(tuitionAmount) && tuitionAmount > 0) {
      score += 1;
    }
  }

  return score;
}

function matchesSnapshotQuality(
  program: StudyAbroadFinderProgram,
  snapshotQuality: string
) {
  if (!snapshotQuality) return true;

  const snapshot = program.admissionsSnapshot;
  if (snapshotQuality === "ready-only") {
    return snapshot?.extractionStatus === "ok";
  }

  if (snapshotQuality === "synced-only") {
    return Boolean(snapshot?.extractedAt);
  }

  if (snapshotQuality === "structured-only") {
    return hasStructuredSnapshot(program);
  }

  return true;
}

function matchesBudgetTier(tuitionAmount: string, budgetTier: string) {
  if (!budgetTier) return true;

  const amount = Number(tuitionAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return false;
  }

  switch (budgetTier) {
    case "under-30000":
      return amount <= 30000;
    case "under-50000":
      return amount <= 50000;
    case "under-70000":
      return amount <= 70000;
    case "under-90000":
      return amount <= 90000;
    default:
      return true;
  }
}

function matchesIntake(intakeText?: string, intakeFilter?: string) {
  if (!intakeFilter) return true;

  const normalized = normalizeText(intakeText);
  if (!normalized) return false;

  const intakeHints: Record<string, string[]> = {
    spring: ["春", "spring", "january", "jan", "february", "feb"],
    summer: ["夏", "summer", "may", "june", "jun", "july", "jul"],
    fall: ["秋", "fall", "autumn", "september", "sep", "august", "aug"],
    winter: ["冬", "winter", "december", "dec", "november", "nov"],
    rolling: ["滚动", "rolling"],
  };

  const hints = intakeHints[intakeFilter] ?? [];
  return hints.some((hint) => normalized.includes(normalizeText(hint)));
}

function normalizeText(value?: string) {
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

function findBestAliasLabel(
  rawValue: string,
  aliasGroups: Record<string, string[]>
) {
  const value = normalizeText(rawValue);
  if (!value) return "";

  let winner = "";
  let winnerScore = 0;

  Object.entries(aliasGroups).forEach(([label, aliases]) => {
    [label, ...aliases].forEach((alias) => {
      const normalizedAlias = normalizeText(alias);
      if (!normalizedAlias || !value.includes(normalizedAlias)) {
        return;
      }

      const score =
        normalizedAlias.length * 10 + (normalizeText(label) === normalizedAlias ? 1 : 0);
      if (score > winnerScore) {
        winner = label;
        winnerScore = score;
      }
    });
  });

  return winner;
}

function inferStudyAbroadQueryFromFreeText(freeText: string) {
  const specialization = findBestAliasLabel(freeText, SPECIALIZATION_QUERY_ALIASES);
  const majorFromSpecialization = specialization
    ? SPECIALIZATION_TO_MAJOR[specialization] || ""
    : "";
  const major =
    majorFromSpecialization ||
    findBestAliasLabel(freeText, MAJOR_QUERY_ALIASES) ||
    findBestAliasLabel(freeText, MAJOR_FAMILIES);

  return {
    country: findBestAliasLabel(freeText, COUNTRY_QUERY_ALIASES),
    degree: findBestAliasLabel(freeText, DEGREE_QUERY_ALIASES),
    major,
    specialization,
  };
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

  // English aliases should match full tokens so `art` won't hit `artificial`.
  if (isAsciiSingleTokenKeyword(keyword)) {
    return tokenSet.has(keyword);
  }

  return searchText.includes(keyword);
}

function expandQueryTokens(...values: string[]) {
  const normalizedValues = values
    .map((value) => normalizeText(value))
    .filter(Boolean);

  if (!normalizedValues.length) return [];

  const expanded = new Set(
    normalizedValues.flatMap((value) => value.split(" ").filter(Boolean))
  );

  [MAJOR_FAMILIES, SPECIALIZATION_QUERY_ALIASES].forEach((aliasGroup) => {
    Object.entries(aliasGroup).forEach(([label, keywords]) => {
      const normalizedLabel = normalizeText(label);
      const hasFamilyMatch = normalizedValues.some(
        (query) =>
          query.includes(normalizedLabel) ||
          keywords.some((keyword) => query.includes(normalizeText(keyword)))
      );

      if (hasFamilyMatch) {
        expanded.add(normalizedLabel);
        keywords.forEach((keyword) => expanded.add(normalizeText(keyword)));
      }
    });
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

export async function searchVerifiedStudyAbroadPrograms(
  input: StudyAbroadSearchInput,
  programs?: StudyAbroadFinderProgram[]
) {
  const query = normalizeStudyAbroadQuery(input);
  const queryTokens = expandQueryTokens(query.major, query.specialization, query.freeText);
  const specializationMajor = query.specialization
    ? SPECIALIZATION_TO_MAJOR[query.specialization] || ""
    : "";
  const expectedDiscipline = query.major || specializationMajor;
  const sourcePrograms = programs ?? (await readStudyAbroadFinderPrograms());

  return sourcePrograms.map((program) => {
    if (query.universityId && program.universityId !== query.universityId) {
      return null;
    }

    if (query.country && program.country !== query.country) {
      return null;
    }

    if (query.degree && program.degree !== query.degree) {
      return null;
    }

    if (!matchesSnapshotQuality(program, query.snapshotQuality)) {
      return null;
    }

    if (!matchesBudgetTier(program.tuitionAmount, query.budgetTier)) {
      return null;
    }

    if (!matchesIntake(program.intake, query.intake)) {
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

    if (expectedDiscipline && program.discipline === expectedDiscipline) {
      score += 18;
    } else if (query.major && program.discipline === query.major) {
      score += 12;
    }

    if (query.major || query.specialization) {
      const terms = [
        {
          value: query.major,
          aliases: MAJOR_QUERY_ALIASES,
          scoreLong: 9,
          scoreShort: 4,
          required: !query.specialization,
        },
        {
          value: query.specialization,
          aliases: SPECIALIZATION_QUERY_ALIASES,
          scoreLong: 12,
          scoreShort: 6,
          required: false,
        },
      ].filter((item) => item.value);
      let matchedTermCount = 0;
      let tokenMatchCount = 0;

      for (const term of terms) {
        const rawQuery = normalizeText(term.value ?? "");
        const aliases = expandQueryAliases(term.value ?? "", term.aliases, [
          term.value ?? "",
        ]).map((item) => normalizeText(item));

        let termMatched =
          Boolean(rawQuery) && matchNormalizedKeyword(searchText, tokenSet, rawQuery);

        aliases.forEach((alias) => {
          if (matchNormalizedKeyword(searchText, tokenSet, alias)) {
            termMatched = true;
            score += alias.length > 2 ? term.scoreLong : term.scoreShort;
          }
        });

        if (termMatched) {
          matchedTermCount += 1;
        } else if (term.required) {
          return null;
        }
      }

      queryTokens.forEach((token) => {
        if (matchNormalizedKeyword(searchText, tokenSet, token)) {
          tokenMatchCount += 1;
          score += token.length > 2 ? 4 : 2;
        }
      });

      if (!matchedTermCount && !tokenMatchCount) {
        const disciplineLooksRelated =
          Boolean(expectedDiscipline && program.discipline === expectedDiscipline) ||
          Boolean(query.major && program.discipline === query.major);

        if (!disciplineLooksRelated) {
          return null;
        }
      }

      if (matchedTermCount === 1 && query.major && query.specialization) {
        score += 4;
      }
    }

    if (query.country) score += 12;
    if (query.degree) score += 6;
    score += admissionsCoverageWeight(program);
    score += referenceDataWeight(program);
    score += consultationReadinessWeight(program, query);

    return { program, score };
  })
    .filter((item): item is { program: StudyAbroadFinderProgram; score: number } => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .map((item) => item.program);
}

async function buildCountryCatalogUniversityMatches(
  country: string,
  programs: StudyAbroadFinderProgram[]
) {
  const universities = await readStudyAbroadCatalogUniversities();
  const programStats = new Map<
    string,
    {
      programCount: number;
      featuredScore: number;
      topDisciplines: string[];
      featuredPrograms: string[];
      tuitionProjectCount: number;
      tuitionMin: number | null;
      tuitionMax: number | null;
      tuitionCurrency: string;
    }
  >();

  programs.forEach((program) => {
    const key = program.universityId || program.schoolName;
    const current = programStats.get(key);

    if (!current) {
      const tuitionAmount = Number(program.tuitionAmount);
      programStats.set(key, {
        programCount: 1,
        featuredScore: Number(program.priority ?? 0),
        topDisciplines: [program.discipline].filter(Boolean),
        featuredPrograms: [program.programName].filter(Boolean),
        tuitionProjectCount:
          Number.isFinite(tuitionAmount) && tuitionAmount > 0 ? 1 : 0,
        tuitionMin:
          Number.isFinite(tuitionAmount) && tuitionAmount > 0 ? tuitionAmount : null,
        tuitionMax:
          Number.isFinite(tuitionAmount) && tuitionAmount > 0 ? tuitionAmount : null,
        tuitionCurrency:
          Number.isFinite(tuitionAmount) && tuitionAmount > 0 ? program.tuitionCurrency || "" : "",
      });
      return;
    }

    current.programCount += 1;
    current.featuredScore = Math.max(current.featuredScore, Number(program.priority ?? 0));

    if (program.discipline && !current.topDisciplines.includes(program.discipline)) {
      current.topDisciplines = [...current.topDisciplines, program.discipline].slice(0, 3);
    }

    if (program.programName && !current.featuredPrograms.includes(program.programName)) {
      current.featuredPrograms = [...current.featuredPrograms, program.programName].slice(0, 2);
    }

    const tuitionAmount = Number(program.tuitionAmount);
    if (Number.isFinite(tuitionAmount) && tuitionAmount > 0) {
      current.tuitionProjectCount += 1;
      current.tuitionMin =
        current.tuitionMin === null ? tuitionAmount : Math.min(current.tuitionMin, tuitionAmount);
      current.tuitionMax =
        current.tuitionMax === null ? tuitionAmount : Math.max(current.tuitionMax, tuitionAmount);

      if (!current.tuitionCurrency && program.tuitionCurrency) {
        current.tuitionCurrency = program.tuitionCurrency;
      }
    }
  });

  return universities
    .filter((university) => university.country === country)
    .map((university) => {
      const stats = programStats.get(university.id);

      return {
        universityId: university.id,
        schoolName: university.name,
        schoolNameZh: university.nameZh || "",
        country: university.country,
        city: university.city,
        stateOrProvince: university.stateOrProvince,
        officialWebsite: university.officialWebsite,
        qsRank: university.qsRank ?? null,
        qsRankingYear: university.qsRankingYear ?? null,
        rankingSource: university.rankingSource ?? "",
        programCount: stats?.programCount ?? 0,
        featuredScore: stats?.featuredScore ?? 0,
        topDisciplines: stats?.topDisciplines ?? [],
        featuredPrograms: stats?.featuredPrograms ?? [],
        tuitionProjectCount: stats?.tuitionProjectCount ?? 0,
        tuitionMin: stats?.tuitionMin ?? null,
        tuitionMax: stats?.tuitionMax ?? null,
        tuitionCurrency: stats?.tuitionCurrency ?? "",
      } satisfies StudyAbroadUniversityMatch;
    })
    .sort(compareUniversityMatches);
}

export async function searchStudyAbroadPrograms(
  input: StudyAbroadSearchInput,
  options?: {
    includeExternalCandidates?: boolean;
  }
): Promise<StudyAbroadSearchResult> {
  const searchSessionId = createSearchSessionId(input);
  const query = normalizeStudyAbroadQuery(input);
  const [sourcePrograms, blocklist] = await Promise.all([
    readStudyAbroadFinderPrograms(),
    readStudyAbroadSearchBlocklist(),
  ]);
  const filteredSourcePrograms = sourcePrograms.filter(
    (program) => !isBlockedStudyAbroadFinderProgram(program, blocklist)
  );
  const blockedVerifiedCount = Math.max(0, sourcePrograms.length - filteredSourcePrograms.length);
  const searchedVerifiedResults = await searchVerifiedStudyAbroadPrograms(
    query,
    filteredSourcePrograms
  );
  const {
    results: allVerifiedResults,
    cachedFitCount,
    fitMode,
    filteredByFitModeCount,
    fitSummary,
  } = await prioritizeVerifiedResultsByCachedFit(searchedVerifiedResults, query);
  const verifiedResults = query.universityId
    ? allVerifiedResults
    : allVerifiedResults.slice(0, MAX_VERIFIED_RESULTS);
  const allUniversityMatches =
    query.country &&
    !query.major &&
    !query.specialization &&
    !query.degree &&
    !query.budgetTier &&
    !query.intake &&
    !query.universityId
      ? await buildCountryCatalogUniversityMatches(query.country, filteredSourcePrograms)
      : buildUniversityMatches(allVerifiedResults);
  const universityMatches = allUniversityMatches;
  const expansionEnabled = canUseExternalSearch();
  const includeExternalCandidates = options?.includeExternalCandidates === true;
  const shouldExpand =
    includeExternalCandidates &&
    shouldRunExternalSearch(query, verifiedResults) &&
    expansionEnabled;
  let pendingReviewCount = 0;
  let expansionAttempted = false;
  let candidateResults: SearchWebCandidate[] = [];

  if (shouldExpand) {
    expansionAttempted = true;
    const candidateSearch = await searchExternalOfficialCandidates(
      query,
      verifiedResults,
      blocklist
    );
    candidateResults = candidateSearch.candidates;

    if (candidateResults.length) {
      const queued = await enqueueStudyAbroadReview({
        ...query,
        candidates: selectCandidatesForReviewQueue(candidateResults),
      });

      if (queued.saved) {
        pendingReviewCount = Math.min(
          candidateResults.length,
          MAX_REVIEW_QUEUE_CANDIDATES
        );
      }
    }
    const blockedResultCount = blockedVerifiedCount + candidateSearch.blockedCount;

    const message = buildSearchMessage({
      query,
      displayedVerifiedCount: verifiedResults.length,
      totalVerifiedCount: allVerifiedResults.length,
      universityCount: allUniversityMatches.length,
      candidateCount: candidateResults.length,
      expansionEnabled,
      expansionAttempted,
      pendingReviewCount,
      cachedFitCount,
      fitMode,
      filteredByFitModeCount,
      fitSummary,
      blockedResultCount,
    });

    await upsertStudyAbroadSearchAuditEntry({
      sessionId: searchSessionId,
      query,
      message,
      totalVerifiedCount: allVerifiedResults.length,
      displayedVerifiedCount: verifiedResults.length,
      totalUniversityCount: allUniversityMatches.length,
      candidateCount: candidateResults.length,
      pendingReviewCount,
      blockedResultCount,
      results: [
        ...toAuditResultsFromVerifiedPrograms(verifiedResults),
        ...toAuditResultsFromCandidates(candidateResults),
      ],
    });

    return {
      searchSessionId,
      resolvedQuery: query,
      verifiedResults,
      totalVerifiedCount: allVerifiedResults.length,
      displayedVerifiedCount: verifiedResults.length,
      universityMatches,
      totalUniversityCount: allUniversityMatches.length,
      candidateResults,
      expansionEnabled,
      expansionAttempted,
      pendingReviewCount,
      blockedResultCount,
      message,
    };
  }

  const blockedResultCount = blockedVerifiedCount;

  const message = buildSearchMessage({
    query,
    displayedVerifiedCount: verifiedResults.length,
    totalVerifiedCount: allVerifiedResults.length,
    universityCount: allUniversityMatches.length,
    candidateCount: candidateResults.length,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    cachedFitCount,
    fitMode,
    filteredByFitModeCount,
    fitSummary,
    blockedResultCount,
  });

  await upsertStudyAbroadSearchAuditEntry({
    sessionId: searchSessionId,
    query,
    message,
    totalVerifiedCount: allVerifiedResults.length,
    displayedVerifiedCount: verifiedResults.length,
    totalUniversityCount: allUniversityMatches.length,
    candidateCount: candidateResults.length,
    pendingReviewCount,
    blockedResultCount,
    results: [
      ...toAuditResultsFromVerifiedPrograms(verifiedResults),
      ...toAuditResultsFromCandidates(candidateResults),
    ],
  });

  return {
    searchSessionId,
    resolvedQuery: query,
    verifiedResults,
    totalVerifiedCount: allVerifiedResults.length,
    displayedVerifiedCount: verifiedResults.length,
    universityMatches,
    totalUniversityCount: allUniversityMatches.length,
    candidateResults,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    blockedResultCount,
    message,
  };
}

export async function expandStudyAbroadSearchCandidates(
  input: StudyAbroadSearchInput
): Promise<StudyAbroadSearchExpansionResult> {
  const searchSessionId = createSearchSessionId(input);
  const query = normalizeStudyAbroadQuery(input);
  const expansionEnabled = canUseExternalSearch();

  if (!expansionEnabled || !shouldRunExternalSearch(query, [])) {
    return {
      searchSessionId,
      resolvedQuery: query,
      candidateResults: [],
      expansionEnabled,
      expansionAttempted: false,
      pendingReviewCount: 0,
      blockedResultCount: 0,
      message: "",
    };
  }

  const [sourcePrograms, blocklist] = await Promise.all([
    readStudyAbroadFinderPrograms(),
    readStudyAbroadSearchBlocklist(),
  ]);
  const filteredSourcePrograms = sourcePrograms.filter(
    (program) => !isBlockedStudyAbroadFinderProgram(program, blocklist)
  );
  const verifiedResults = await searchVerifiedStudyAbroadPrograms(query, filteredSourcePrograms);
  const candidateSearch = await searchExternalOfficialCandidates(
    query,
    verifiedResults,
    blocklist
  );
  const candidateResults = candidateSearch.candidates;
  let pendingReviewCount = 0;

  if (candidateResults.length) {
    const queued = await enqueueStudyAbroadReview({
      ...query,
      candidates: selectCandidatesForReviewQueue(candidateResults),
    });

    if (queued.saved) {
      pendingReviewCount = Math.min(
        candidateResults.length,
        MAX_REVIEW_QUEUE_CANDIDATES
      );
    }
  }

  const blockedResultCount =
    Math.max(0, sourcePrograms.length - filteredSourcePrograms.length) +
    candidateSearch.blockedCount;

  const message =
    candidateResults.length > 0
      ? pendingReviewCount
        ? `后台已补充 ${candidateResults.length} 条候选官网页，并同步到审核队列。`
        : `后台已补充 ${candidateResults.length} 条候选官网页。`
      : "后台候选官网页扩展未补充到更高质量结果。";

  await upsertStudyAbroadSearchAuditEntry({
    sessionId: searchSessionId,
    query,
    message,
    totalVerifiedCount: verifiedResults.length,
    displayedVerifiedCount: verifiedResults.length,
    totalUniversityCount: 0,
    candidateCount: candidateResults.length,
    pendingReviewCount,
    blockedResultCount,
    results: toAuditResultsFromCandidates(candidateResults),
  });

  return {
    searchSessionId,
    resolvedQuery: query,
    candidateResults,
    expansionEnabled,
    expansionAttempted: true,
    pendingReviewCount,
    blockedResultCount,
    message,
  };
}

function selectCandidatesForReviewQueue(candidates: SearchWebCandidate[]) {
  return candidates.slice(0, MAX_REVIEW_QUEUE_CANDIDATES).map((candidate) => ({
    title: candidate.title,
    link: candidate.link,
    displayLink: candidate.displayLink,
    snippet: candidate.snippet,
    provider: candidate.provider,
  }));
}

function shouldRunExternalSearch(
  query: ReturnType<typeof normalizeStudyAbroadQuery>,
  _verifiedResults: StudyAbroadFinderProgram[]
) {
  return Boolean(query.country && query.degree) && !query.universityId;
}

function buildSearchMessage(params: {
  query: ReturnType<typeof normalizeStudyAbroadQuery>;
  displayedVerifiedCount: number;
  totalVerifiedCount: number;
  universityCount: number;
  candidateCount: number;
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  cachedFitCount: number;
  fitMode: string;
  filteredByFitModeCount: number;
  fitSummary: {
    match: number;
    review: number;
    risk: number;
  };
  blockedResultCount?: number;
}) {
  const {
    query,
    displayedVerifiedCount,
    totalVerifiedCount,
    universityCount,
    candidateCount,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    cachedFitCount,
    fitMode,
    filteredByFitModeCount,
    fitSummary,
    blockedResultCount,
  } = params;
  const hardFilters = [
    query.budgetTier ? "预算" : "",
    query.intake ? "入学季" : "",
  ].filter(Boolean);
  const freeTextNote = query.freeText
    ? " 已结合你的一句话需求自动推断国家、学位和方向。"
    : "";
  const advisoryFilters = [
    query.gpaProfile ? "GPA" : "",
    query.languageProfile ? "语言成绩" : "",
  ].filter(Boolean);
  const snapshotNote =
    query.snapshotQuality === "ready-only"
      ? " 当前只保留门槛已完整入库的项目。"
      : query.snapshotQuality === "structured-only"
        ? " 当前只保留已经抓到结构化门槛字段的项目。"
        : query.snapshotQuality === "synced-only"
          ? " 当前只保留已经同步过官网门槛快照的项目。"
          : "";
  const advisoryNote = advisoryFilters.length
    ? fitMode === "prefer"
      ? ` 当前 ${advisoryFilters.join(" / ")} 只作为背景参考，不做硬过滤，建议继续查看要求摘要核对。`
      : ` 当前 ${advisoryFilters.join(" / ")} 只会对已抓到官网门槛字段的项目应用背景筛选，其余项目仍建议结合要求摘要继续判断。`
    : "";
  const prefetchNote =
    displayedVerifiedCount > 0
      ? " 系统也会在后台继续补抓前排项目的官网门槛，后续搜索会越来越完整。"
      : "";
  const fitModeNote =
    advisoryFilters.length && fitMode === "exclude-risk"
      ? ` 当前背景策略为“排除明显偏紧”，已额外排除 ${filteredByFitModeCount} 个偏紧项目。`
      : advisoryFilters.length && fitMode === "match-only"
        ? ` 当前背景策略为“只看已确认匹配”，仅保留已抓到官网门槛且判断为匹配的项目。`
        : "";
  const fitCacheNote =
    cachedFitCount && advisoryFilters.length
      ? ` 已按 ${cachedFitCount} 个已抓取官网要求的项目做背景优先排序，其中更匹配 ${fitSummary.match} 个、待核对 ${fitSummary.review} 个、偏紧 ${fitSummary.risk} 个。`
      : advisoryFilters.length
        ? " 当前还没有足够多的官网要求缓存，背景匹配提示会随着后续查看逐步补齐。"
        : "";
  const hardFilterNote = hardFilters.length
    ? ` 已按${hardFilters.join("、")}做硬筛。`
    : "";
  const governanceNote = blockedResultCount
    ? ` 后台已自动避开 ${blockedResultCount} 条曾被管理员判定为不符合标准的结果。`
    : "";
  const rankingNote =
    displayedVerifiedCount > 0
      ? " 结果会优先按专业匹配、门槛完整度和官网可核验度排序。"
      : "";
  const withGovernanceNote = (message: string) => `${message}${governanceNote}`.trim();

  if (query.universityId && totalVerifiedCount) {
    const projectText =
      totalVerifiedCount > displayedVerifiedCount
        ? `${totalVerifiedCount} 个项目，当前展示前 ${displayedVerifiedCount} 个`
        : `${totalVerifiedCount} 个项目`;
    return withGovernanceNote(
      `已切换到当前学校，找到 ${projectText}。${freeTextNote}${rankingNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
    );
  }

  if (query.universityId && !totalVerifiedCount) {
    if (advisoryFilters.length && fitMode !== "prefer" && filteredByFitModeCount > 0) {
      return withGovernanceNote(
        `这所学校原本有项目命中，但当前背景策略把它们筛掉了。建议先切回“推荐排序”，或放宽 GPA / 语言条件后再看。${hardFilterNote}${fitCacheNote}${advisoryNote}`.trim()
      );
    }

    if (query.budgetTier || query.intake) {
      return withGovernanceNote(
        `这所学校当前没有命中符合预算或入学季条件的项目。可以先放宽预算 / 入学季，再继续查看该校项目。${advisoryNote}`.trim()
      );
    }

    return withGovernanceNote(
      "这所学校已经进入学校底库，但当前还没有补齐可展示的项目层数据。可以先切回全部院校，或继续缩小专业方向。"
    );
  }

  if (query.country && !query.major) {
    if (universityCount) {
      const projectText =
        totalVerifiedCount > displayedVerifiedCount
          ? `${totalVerifiedCount} 个项目，当前展示前 ${displayedVerifiedCount} 个`
          : `${totalVerifiedCount} 个项目`;
      return withGovernanceNote(
        `已定位 ${universityCount} 所学校、${projectText}。现在可以继续输入专业，或先点击某所学校查看该校项目。${freeTextNote}${rankingNote}${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${prefetchNote}${advisoryNote}`.trim()
      );
    }

    if (!expansionEnabled) {
      return withGovernanceNote(
        "当前国家下暂时没有可展示的已核验学校项目，且站点还未配置百度搜索 API。建议先放宽国家或补充专业方向。"
      );
    }
  }

  if (totalVerifiedCount) {
    const verifiedLead =
      totalVerifiedCount > displayedVerifiedCount
        ? `已找到 ${totalVerifiedCount} 条已核验官方项目，当前展示前 ${displayedVerifiedCount} 条`
        : `已返回 ${totalVerifiedCount} 条已核验官方项目`;

    if (candidateCount) {
      if (pendingReviewCount) {
        return withGovernanceNote(
          `${verifiedLead}，并补充 ${candidateCount} 条全网候选官网页；候选结果也已同步到后台审核。${freeTextNote}${rankingNote}${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${prefetchNote}${advisoryNote}`.trim()
        );
      }

      return withGovernanceNote(
        `${verifiedLead}，并补充 ${candidateCount} 条全网候选官网页。候选页仅作扩展参考，不会替代正式推荐。${freeTextNote}${rankingNote}${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${prefetchNote}${advisoryNote}`.trim()
      );
    }

    if (expansionAttempted) {
      return withGovernanceNote(
        `${verifiedLead}；本轮全网搜索没有补充到更高质量的候选官网页。${freeTextNote}${rankingNote}${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${prefetchNote}${advisoryNote}`.trim()
      );
    }

    if (!expansionEnabled) {
      return withGovernanceNote(
        `${verifiedLead}。当前站点未配置百度搜索 API，所以不会实时补抓新院校。${freeTextNote}${rankingNote}${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${prefetchNote}${advisoryNote}`.trim()
      );
    }

    return withGovernanceNote(
      `${verifiedLead}。${freeTextNote}${rankingNote}${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${prefetchNote}${advisoryNote}`.trim()
    );
  }

  if (!expansionEnabled) {
    if (query.degree === "本科" || query.degree === "博士") {
      return withGovernanceNote(
        `当前学校底库已经支持按国家先筛学校，但 ${query.degree} 项目层还在持续补充，建议先切到硕士查看已核验项目，或先浏览学校池。`
      );
    }

    return withGovernanceNote(
      "当前项目库里没有完全匹配结果，且站点还未配置百度搜索 API。建议先放宽专业词，或补充百度 AppBuilder API Key。"
    );
  }

  if (candidateCount) {
    if (query.degree === "本科" || query.degree === "博士") {
      const lead = `当前学校底库已经支持按国家先筛学校，但 ${query.degree} 项目层还在持续补充。`;

      if (pendingReviewCount) {
        return withGovernanceNote(
          `${lead} 本轮已从全网筛出 ${candidateCount} 条候选官网页，并已送入后台审核。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
        );
      }

      return withGovernanceNote(
        `${lead} 本轮已从全网筛出 ${candidateCount} 条候选官网页，建议先参考这些官网页，再由后台补入正式项目库。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
      );
    }

    if (pendingReviewCount) {
      return withGovernanceNote(
        `当前没有命中已核验项目，但已从全网筛出 ${candidateCount} 条候选官网页，并已送入后台审核。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
      );
    }

    return withGovernanceNote(
      `当前没有命中已核验项目，但已从全网筛出 ${candidateCount} 条候选官网页。建议先参考这些官网页，再由后台补入正式项目库。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
    );
  }

  if (advisoryFilters.length && fitMode !== "prefer" && filteredByFitModeCount > 0) {
    return withGovernanceNote(
      `当前没有留下符合背景策略的已核验项目。建议先切回“推荐排序”，再结合项目卡里的背景匹配提示做判断。${hardFilterNote}${fitCacheNote}${advisoryNote}`.trim()
    );
  }

  if (query.degree === "本科" || query.degree === "博士") {
    return withGovernanceNote(
      `当前学校底库已经支持按国家先筛学校，但 ${query.degree} 项目层还在持续补充。可以先浏览学校池，或切到硕士查看已核验项目。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
    );
  }

  if (hardFilters.length) {
    return withGovernanceNote(
      `当前没有匹配到已核验项目，后台也没有抓到足够可靠的候选官网页。建议先放宽预算或入学季，再回头调整国家和专业方向。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
    );
  }

  return withGovernanceNote(
    `当前没有匹配到已核验项目，后台也没有抓到足够可靠的候选官网页。建议先放宽国家或专业方向。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
  );
}

function compareUniversityMatches(
  left: StudyAbroadUniversityMatch,
  right: StudyAbroadUniversityMatch
) {
  const leftRank = Number.isFinite(left.qsRank ?? NaN) && (left.qsRank ?? 0) > 0
    ? (left.qsRank ?? 999999)
    : 999999;
  const rightRank = Number.isFinite(right.qsRank ?? NaN) && (right.qsRank ?? 0) > 0
    ? (right.qsRank ?? 999999)
    : 999999;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  if (left.featuredScore !== right.featuredScore) {
    return right.featuredScore - left.featuredScore;
  }

  if (left.programCount !== right.programCount) {
    return right.programCount - left.programCount;
  }

  return left.schoolName.localeCompare(right.schoolName, "en-US");
}

function buildUniversityMatches(programs: StudyAbroadFinderProgram[]) {
  const matches = new Map<string, StudyAbroadUniversityMatch>();

  programs.forEach((program) => {
    const key = program.universityId || program.schoolName;
    const current = matches.get(key);

    if (!current) {
      matches.set(key, {
        universityId: key,
        schoolName: program.schoolName,
        schoolNameZh: program.schoolNameZh || "",
        country: program.country,
        city: program.city,
        stateOrProvince: program.stateOrProvince,
        officialWebsite: program.officialWebsite || program.overviewUrl,
        qsRank: program.qsRank ?? null,
        qsRankingYear: program.qsRankingYear ?? null,
        rankingSource: program.rankingSource ?? "",
        programCount: 1,
        featuredScore: Number(program.priority ?? 0),
        topDisciplines: [program.discipline].filter(Boolean),
        featuredPrograms: [program.programName].filter(Boolean),
        tuitionProjectCount: 0,
        tuitionMin: null,
        tuitionMax: null,
        tuitionCurrency: "",
      });

      const created = matches.get(key);
      const tuitionAmount = Number(program.tuitionAmount);
      if (
        created &&
        Number.isFinite(tuitionAmount) &&
        tuitionAmount > 0
      ) {
        created.tuitionProjectCount = 1;
        created.tuitionMin = tuitionAmount;
        created.tuitionMax = tuitionAmount;
        created.tuitionCurrency = program.tuitionCurrency || "";
      }
      return;
    }

    current.programCount += 1;
    current.featuredScore = Math.max(current.featuredScore, Number(program.priority ?? 0));

    if (
      (!current.qsRank || current.qsRank <= 0) &&
      program.qsRank &&
      program.qsRank > 0
    ) {
      current.qsRank = program.qsRank;
      current.qsRankingYear = program.qsRankingYear;
      current.rankingSource = program.rankingSource;
    }

    if (program.discipline && !current.topDisciplines.includes(program.discipline)) {
      current.topDisciplines = [...current.topDisciplines, program.discipline].slice(0, 3);
    }

    if (program.programName && !current.featuredPrograms.includes(program.programName)) {
      current.featuredPrograms = [...current.featuredPrograms, program.programName].slice(0, 2);
    }

    if (!current.schoolNameZh && program.schoolNameZh) {
      current.schoolNameZh = program.schoolNameZh;
    }

    const tuitionAmount = Number(program.tuitionAmount);
    if (Number.isFinite(tuitionAmount) && tuitionAmount > 0) {
      current.tuitionProjectCount += 1;
      current.tuitionMin =
        current.tuitionMin === null ? tuitionAmount : Math.min(current.tuitionMin, tuitionAmount);
      current.tuitionMax =
        current.tuitionMax === null ? tuitionAmount : Math.max(current.tuitionMax, tuitionAmount);

      if (!current.tuitionCurrency && program.tuitionCurrency) {
        current.tuitionCurrency = program.tuitionCurrency;
      }
    }
  });

  return Array.from(matches.values()).sort(compareUniversityMatches);
}

function canUseExternalSearch() {
  return Boolean(getBaiduSearchApiKey());
}

export function getStudyAbroadSearchRuntimeStatus() {
  const enabled = canUseExternalSearch();

  return {
    externalSearchEnabled: enabled,
    provider: "baidu-web-search",
    model: BAIDU_SEARCH_MODEL,
    apiKeyPresent: enabled,
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxCandidateResults: MAX_CANDIDATE_RESULTS,
    maxReviewQueueCandidates: MAX_REVIEW_QUEUE_CANDIDATES,
  };
}

export async function runStudyAbroadSearchRuntimeCheck(input?: {
  probe?: boolean;
  freeText?: string;
  country?: string;
  degree?: string;
  major?: string;
  specialization?: string;
}): Promise<StudyAbroadSearchRuntimeCheckResult> {
  const status = getStudyAbroadSearchRuntimeStatus();
  const normalizedQuery = normalizeStudyAbroadQuery({
    freeText: input?.freeText || "",
    country: input?.country || "英国",
    degree: input?.degree || "硕士",
    major: input?.major || "金融",
    specialization: input?.specialization || "",
  });
  const probeQuery =
    String(input?.freeText || "").trim() ||
    buildExternalQueries(normalizedQuery)[0] ||
    "英国 硕士 金融 大学 官网 招生 项目 申请 条件";

  const baseResult: StudyAbroadSearchRuntimeCheckResult = {
    status,
    probe: {
      attempted: false,
      ok: false,
      query: probeQuery,
      rawReferenceCount: 0,
      candidateCount: 0,
      message: status.apiKeyPresent
        ? "运行时已检测到百度扩搜密钥，尚未执行探测。"
        : "运行时还没有检测到百度扩搜密钥。",
    },
  };

  if (!input?.probe) {
    return baseResult;
  }

  const apiKey = getBaiduSearchApiKey();
  if (!apiKey) {
    return {
      ...baseResult,
      probe: {
        ...baseResult.probe,
        attempted: true,
        message: "未检测到百度扩搜密钥，无法执行全网扩搜探测。",
      },
    };
  }

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
          content: probeQuery,
        },
      ],
      search_source: "baidu_search_v2",
      resource_type_filter: [{ type: "web", top_k: 20 }],
      block_websites: BLOCKED_WEBSITES,
    }),
  });

  const items = Array.isArray(response?.references)
    ? (response.references as Record<string, unknown>[])
    : [];
  const rawWebReferences = items.filter((item) => item?.type === "web");
  const candidateCount = rawWebReferences
    .map((item: Record<string, unknown>) => {
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
        score: scoreCandidate(candidate, normalizedQuery),
      };
    })
    .filter((candidate) => Number(candidate.score ?? 0) >= MIN_CANDIDATE_SCORE).length;

  const ok = rawWebReferences.length > 0 || candidateCount > 0;

  return {
    status,
    probe: {
      attempted: true,
      ok,
      query: probeQuery,
      rawReferenceCount: rawWebReferences.length,
      candidateCount,
      message: ok
        ? `探测成功，返回 ${rawWebReferences.length} 条原始参考，${candidateCount} 条通过候选筛选。`
        : "探测请求已发起，但没有拿到可用参考结果；请检查密钥权限、模型配置或网络连通性。",
    },
  };
}

async function searchExternalOfficialCandidates(
  query: ReturnType<typeof normalizeStudyAbroadQuery>,
  verifiedResults: StudyAbroadFinderProgram[],
  blocklist: Awaited<ReturnType<typeof readStudyAbroadSearchBlocklist>>
): Promise<SearchExternalCandidatesResult> {
  const queries = buildExternalQueries(query);
  const baiduApiKey = getBaiduSearchApiKey();
  const verifiedLinks = new Set(
    verifiedResults.flatMap((program) =>
      [program.overviewUrl, program.admissionsUrl].filter(Boolean)
    )
  );

  if (!baiduApiKey) {
    return {
      candidates: [],
      blockedCount: 0,
    };
  }

  const resultSets = await Promise.all(
    queries.map((item) => searchBaiduCandidates(item, baiduApiKey, query))
  );

  const dedupedCandidates = dedupeCandidates(resultSets.flat()).filter(
    (candidate) => !verifiedLinks.has(candidate.link)
  );
  let blockedCount = 0;
  const candidates: SearchWebCandidate[] = [];

  dedupedCandidates.forEach((candidate) => {
    if (isBlockedStudyAbroadCandidate(candidate, blocklist)) {
      blockedCount += 1;
      return;
    }

    if (candidates.length < MAX_CANDIDATE_RESULTS) {
      candidates.push(candidate);
    }
  });

  return {
    candidates,
    blockedCount,
  };
}

function buildExternalQueries(query: ReturnType<typeof normalizeStudyAbroadQuery>) {
  const majorAliases = expandQueryAliases(
    query.major,
    MAJOR_QUERY_ALIASES,
    [query.major || "研究生项目"]
  ).slice(0, 6);
  const specializationAliases = expandQueryAliases(
    query.specialization,
    SPECIALIZATION_QUERY_ALIASES,
    [query.specialization || ""]
  )
    .filter(Boolean)
    .slice(0, 6);
  const locationAliases = expandQueryAliases(
    query.country,
    COUNTRY_QUERY_ALIASES,
    [query.country || "大学"]
  ).slice(0, 6);
  const degreeAliases = expandQueryAliases(
    query.degree,
    DEGREE_QUERY_ALIASES,
    [query.degree || "硕士"]
  ).slice(0, 6);

  const chineseLocation = locationAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || locationAliases[0];
  const englishLocation = locationAliases.find((item) => /[a-z]/i.test(item)) || locationAliases[0];
  const chineseMajor = majorAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || majorAliases[0];
  const englishMajor = majorAliases.find((item) => /[a-z]/i.test(item)) || majorAliases[0];
  const chineseSpecialization =
    specializationAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || "";
  const englishSpecialization =
    specializationAliases.find((item) => /[a-z]/i.test(item)) || "";
  const chineseDegree = degreeAliases.find((item) => /[\u4e00-\u9fff]/.test(item)) || degreeAliases[0];
  const englishDegree = degreeAliases.find((item) => /[a-z]/i.test(item)) || degreeAliases[0];

  const phrases = [
    `${chineseLocation} ${chineseMajor} ${chineseSpecialization} ${chineseDegree} 官网 招生 项目 申请 条件`,
    `${chineseLocation} ${chineseMajor} ${chineseDegree} 官方 项目 课程 申请 要求`,
    `${chineseLocation} ${chineseDegree} ${chineseSpecialization || chineseMajor} 大学 官网 专业 申请`,
    `${englishLocation} ${englishMajor} ${englishSpecialization} ${englishDegree} university official admissions program`,
    `${englishLocation} ${englishMajor} ${englishDegree} official course admission requirements university`,
    `${englishLocation} ${englishDegree} ${englishSpecialization || englishMajor} university official graduate admission`,
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
      resource_type_filter: [{ type: "web", top_k: 50 }],
      block_websites: BLOCKED_WEBSITES,
    }),
  });

  const items = Array.isArray(response?.references)
    ? (response.references as Record<string, unknown>[])
    : [];

  return items
    .filter((item: Record<string, unknown>) => item?.type === "web")
    .map((item: Record<string, unknown>) => {
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
    .filter((candidate: SearchWebCandidate) => Number(candidate.score ?? 0) >= MIN_CANDIDATE_SCORE);
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
