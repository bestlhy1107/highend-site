import { randomUUID } from "node:crypto";
import {
  COUNTRY_QUERY_ALIASES,
  DEGREE_QUERY_ALIASES,
  MAJOR_QUERY_ALIASES,
  MAJOR_FAMILIES,
  normalizeStudyAbroadMajor,
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
  collectBlockedStudyAbroadCandidateRuleIds,
  collectBlockedStudyAbroadFinderProgramRuleIds,
  recordStudyAbroadSearchAvoidRuleHits,
  readStudyAbroadSearchBlocklist,
  upsertStudyAbroadSearchAuditEntry,
  type StudyAbroadSearchAuditResult,
} from "./study-abroad-search-governance";
import { readStudyAbroadCachedAdmissionsInsights } from "./study-abroad-admissions";
import {
  buildStudyAbroadFitPreviewFromInsight,
  type StudyAbroadFitPreview,
} from "./study-abroad-fit";
import {
  searchStudyAbroadProgramsFromDb,
  type StudyAbroadSearchDbResult,
} from "./study-abroad-search-db";

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
  page?: number;
  pageSize?: number;
  universityPage?: number;
  universityPageSize?: number;
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

export type StudyAbroadSearchGuidance = {
  failureReason: string;
  failureReasonCode: string;
  nextSteps: string[];
  intentSignals: string[];
  rankingSignals: string[];
  candidateQualitySummary: string;
};

export type StudyAbroadSearchCandidateResult = StudyAbroadReviewCandidate & {
  date?: string;
  authorityScore?: number;
  rerankScore?: number;
  score?: number;
  credibilityLevel: "high" | "medium" | "watch";
  credibilityLabel: string;
  credibilityReason: string;
  relevanceSignals: string[];
};

export type StudyAbroadSearchResult = {
  searchSessionId: string;
  resolvedQuery: StudyAbroadResolvedQuery;
  verifiedResults: StudyAbroadFinderProgram[];
  totalVerifiedCount: number;
  displayedVerifiedCount: number;
  universityMatches: StudyAbroadUniversityMatch[];
  totalUniversityCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  searchBackend: "sqlite" | "json";
  candidateResults: StudyAbroadReviewCandidate[];
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  blockedResultCount: number;
  message: string;
  searchGuidance: StudyAbroadSearchGuidance;
};

export type StudyAbroadSearchExpansionResult = {
  searchSessionId: string;
  resolvedQuery: StudyAbroadResolvedQuery;
  candidateResults: StudyAbroadSearchCandidateResult[];
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  pendingReviewCount: number;
  blockedResultCount: number;
  message: string;
  searchGuidance: StudyAbroadSearchGuidance;
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

type SearchWebCandidate = StudyAbroadSearchCandidateResult & {
  date?: string;
  authorityScore?: number;
  rerankScore?: number;
  score?: number;
};

type SearchExternalCandidatesResult = {
  candidates: SearchWebCandidate[];
  blockedCount: number;
  blockedRuleHits: Array<{
    ruleId: string;
    label: string;
  }>;
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
  高中: [
    "bachelor",
    "undergraduate",
    "master",
    "masters",
    "graduate",
    "msc",
    "mba",
    "phd",
    "doctor",
    "doctoral",
  ],
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
const FREE_TEXT_STOPWORDS = new Set([
  "申请",
  "留学",
  "大学",
  "学校",
  "项目",
  "专业",
  "方向",
  "官网",
  "官方",
  "高中",
  "中学",
  "硕士",
  "本科",
  "博士",
  "master",
  "masters",
  "program",
  "programme",
  "official",
  "admission",
  "admissions",
  "graduate",
  "university",
]);

const EXTRA_COUNTRY_ALIASES: Record<string, string[]> = {
  英国: ["uk", "u k", "britain", "england", "united kingdom"],
  美国: ["us", "u s", "usa", "america", "united states"],
  中国香港: ["hk", "h k", "hong kong"],
  新加坡: ["sg", "s g", "singapore"],
  澳大利亚: ["aus", "australia", "aussie"],
  加拿大: ["canada"],
};

const EXTRA_MAJOR_ALIASES: Record<string, string[]> = {
  "计算机 / AI": ["cs", "computer science", "ai", "artificial intelligence", "machine learning"],
  "商业分析 / 数据": ["ba", "business analytics", "data science", "ds", "analytics", "mis", "information systems"],
  金融: ["mfin", "finance", "financial engineering", "mfe", "fintech"],
  传媒: ["media", "communication", "communications", "journalism", "digital media"],
  "设计 / 艺术": ["design", "ux", "ui", "ux design", "interaction design", "hci", "human computer interaction"],
};

const EXTRA_SPECIALIZATION_ALIASES: Record<string, string[]> = {
  商业分析: ["ba", "business analytics", "analytics"],
  数据科学: ["data science", "ds", "machine learning"],
  人工智能: ["ai", "artificial intelligence"],
  交互设计: ["ux", "ui", "ux design", "interaction design", "hci"],
  金融工程: ["financial engineering", "mfe", "quant finance"],
  金融科技: ["fintech"],
  新闻传播: ["journalism", "communications", "media studies"],
};

const EXTRA_DEGREE_ALIASES: Record<string, string[]> = {
  高中: ["secondary", "secondary school", "boarding", "boarding school", "highschool"],
  硕士: ["one year master", "one-year master", "taught master", "graduate taught"],
  本科: ["undergrad", "undergraduate"],
  博士: ["phd", "doctorate", "doctoral"],
};

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

function readableQsRank(value: unknown) {
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0 ? rank : 999999;
}

function compareProgramsByQsRank(
  left: Pick<StudyAbroadFinderProgram, "qsRank">,
  right: Pick<StudyAbroadFinderProgram, "qsRank">
) {
  return readableQsRank(left.qsRank) - readableQsRank(right.qsRank);
}

function compareProgramNames(
  left: Pick<StudyAbroadFinderProgram, "schoolName" | "programName">,
  right: Pick<StudyAbroadFinderProgram, "schoolName" | "programName">
) {
  const schoolOrder = left.schoolName.localeCompare(right.schoolName, "en-US");
  if (schoolOrder !== 0) return schoolOrder;

  return left.programName.localeCompare(right.programName, "en-US");
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
    const rankOrder = compareProgramsByQsRank(left, right);
    if (rankOrder !== 0) return rankOrder;

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

    return compareProgramNames(left, right);
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
  const rawMajor = majorOverride.suppressed
    ? ""
    : majorOverride.value ||
      (specialization ? SPECIALIZATION_TO_MAJOR[specialization] || "" : "") ||
      inferred.major ||
      "";
  const major = normalizeStudyAbroadMajor(rawMajor);

  return {
    freeText,
    country: countryOverride.suppressed
      ? ""
      : countryOverride.value || inferred.country || "",
    major,
    specialization,
    degree: degreeOverride.suppressed ? "" : degreeOverride.value || inferred.degree || "",
    budgetTier: String(input.budgetTier ?? "").trim() || inferred.budgetTier || "",
    intake: String(input.intake ?? "").trim() || inferred.intake || "",
    gpaProfile: String(input.gpaProfile ?? "").trim() || inferred.gpaProfile || "",
    languageProfile: String(input.languageProfile ?? "").trim() || inferred.languageProfile || "",
    fitMode: String(input.fitMode ?? "").trim(),
    snapshotQuality: String(input.snapshotQuality ?? "").trim(),
    universityId: String(input.universityId ?? "").trim(),
  };
}

function createSearchSessionId(input: StudyAbroadSearchInput) {
  return String(input.searchSessionId ?? "").trim() || randomUUID();
}

function clampSearchPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function normalizeSearchPagination(input: StudyAbroadSearchInput) {
  const page = clampSearchPositiveInt(input.page, 1, 10000);
  const pageSize = clampSearchPositiveInt(input.pageSize, MAX_VERIFIED_RESULTS, 200);
  const universityPage = clampSearchPositiveInt(input.universityPage, 1, 10000);
  const universityPageSize = clampSearchPositiveInt(input.universityPageSize, 240, 300);

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    universityPage,
    universityPageSize,
  };
}

function totalPagesFor(totalCount: number, pageSize: number) {
  return Math.max(1, Math.ceil(Math.max(0, totalCount) / Math.max(1, pageSize)));
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

async function persistStudyAbroadSearchAuditEntry(
  input: Parameters<typeof upsertStudyAbroadSearchAuditEntry>[0]
) {
  const task = upsertStudyAbroadSearchAuditEntry(input);

  if (process.env.STUDY_ABROAD_SEARCH_AUDIT_SYNC === "true") {
    await task;
    return;
  }

  void task.catch((error) => {
    console.error("[study-abroad-search] Failed to persist search audit entry", error);
  });
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

function mergeAliasGroups(...groups: Record<string, string[]>[]) {
  const merged: Record<string, string[]> = {};

  groups.forEach((group) => {
    Object.entries(group).forEach(([label, aliases]) => {
      merged[label] = [...(merged[label] || []), ...aliases];
    });
  });

  return merged;
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

function inferGpaProfileFromFreeText(freeText: string) {
  const value = String(freeText || "").trim().toLowerCase();
  if (!value) return "";

  const match = value.match(/gpa\s*[:：]?\s*(\d(?:\.\d+)?)/i);
  if (!match) return "";

  const gpa = Number(match[1]);
  if (!Number.isFinite(gpa)) return "";
  if (gpa >= 3.7) return "3.7+";
  if (gpa >= 3.5) return "3.5-3.69";
  if (gpa >= 3.3) return "3.3-3.49";
  if (gpa >= 3.0) return "3.0-3.29";
  return "under-3.0";
}

function inferLanguageProfileFromFreeText(freeText: string) {
  const value = String(freeText || "");
  if (!value.trim()) return "";

  const ieltsMatch = value.match(/(?:ielts|雅思)\s*[:：]?\s*(6\.5|7(?:\.0)?)/i);
  if (ieltsMatch) {
    return `IELTS ${ieltsMatch[1] === "7" ? "7.0" : ieltsMatch[1]}`;
  }

  const toeflMatch = value.match(/(?:toefl|托福)\s*[:：]?\s*(90|100)/i);
  if (toeflMatch) {
    return `TOEFL ${toeflMatch[1]}`;
  }

  const duoMatch = value.match(/(?:duolingo|多邻国)\s*[:：]?\s*(120)/i);
  if (duoMatch) {
    return `Duolingo ${duoMatch[1]}`;
  }

  const pteMatch = value.match(/(?:pte)\s*[:：]?\s*(65)/i);
  if (pteMatch) {
    return `PTE ${pteMatch[1]}`;
  }

  return "";
}

function inferBudgetTierFromFreeText(freeText: string) {
  const value = String(freeText || "").toLowerCase();
  if (!value.trim()) return "";

  if (/(?:budget|预算).*(?:30k|30000|3万)/i.test(value)) return "under-30000";
  if (/(?:budget|预算).*(?:50k|50000|5万)/i.test(value)) return "under-50000";
  if (/(?:budget|预算).*(?:70k|70000|7万)/i.test(value)) return "under-70000";
  if (/(?:budget|预算).*(?:90k|90000|9万)/i.test(value)) return "under-90000";

  return "";
}

function inferIntakeFromFreeText(freeText: string) {
  const value = normalizeText(freeText);
  if (!value) return "";

  if (/(26|2026)\s*fall|26fall|2026fall|秋季|fall|autumn/.test(value)) return "fall";
  if (/(26|2026)\s*spring|26spring|2026spring|春季|spring/.test(value)) return "spring";
  if (/(26|2026)\s*summer|26summer|2026summer|夏季|summer/.test(value)) return "summer";
  if (/(26|2026)\s*winter|26winter|2026winter|冬季|winter/.test(value)) return "winter";
  if (/rolling|滚动录取/.test(value)) return "rolling";

  return "";
}

function inferStudyAbroadQueryFromFreeText(freeText: string) {
  const mergedCountryAliases = mergeAliasGroups(COUNTRY_QUERY_ALIASES, EXTRA_COUNTRY_ALIASES);
  const mergedDegreeAliases = mergeAliasGroups(DEGREE_QUERY_ALIASES, EXTRA_DEGREE_ALIASES);
  const mergedMajorAliases = mergeAliasGroups(MAJOR_QUERY_ALIASES, EXTRA_MAJOR_ALIASES);
  const mergedSpecializationAliases = mergeAliasGroups(
    SPECIALIZATION_QUERY_ALIASES,
    EXTRA_SPECIALIZATION_ALIASES
  );
  const specialization = findBestAliasLabel(freeText, mergedSpecializationAliases);
  const majorFromSpecialization = specialization
    ? SPECIALIZATION_TO_MAJOR[specialization] || ""
    : "";
  const major =
    majorFromSpecialization ||
    findBestAliasLabel(freeText, mergedMajorAliases) ||
    findBestAliasLabel(freeText, MAJOR_FAMILIES);

  return {
    country: findBestAliasLabel(freeText, mergedCountryAliases),
    degree: findBestAliasLabel(freeText, mergedDegreeAliases),
    major,
    specialization,
    budgetTier: inferBudgetTierFromFreeText(freeText),
    intake: inferIntakeFromFreeText(freeText),
    gpaProfile: inferGpaProfileFromFreeText(freeText),
    languageProfile: inferLanguageProfileFromFreeText(freeText),
  };
}

function getMeaningfulQueryTokens(...values: string[]) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => normalizeText(value).split(" "))
        .map((token) => token.trim())
        .filter((token) => token && token.length > 1 && !FREE_TEXT_STOPWORDS.has(token))
    )
  );
}

function countKeywordMatches(searchText: string, tokenSet: Set<string>, tokens: string[]) {
  let count = 0;
  tokens.forEach((token) => {
    if (matchNormalizedKeyword(searchText, tokenSet, token)) {
      count += 1;
    }
  });
  return count;
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
  const meaningfulFreeTextTokens = getMeaningfulQueryTokens(
    query.freeText,
    query.major,
    query.specialization
  );
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
        program.schoolNameZh,
        program.programName,
        program.discipline,
        program.summary,
        ...program.keywords,
        ...program.tags,
      ].join(" ")
    );
    const tokenSet = tokenizeText(searchText);

    let score = program.priority;
    const fuzzyQueryOverlap = countKeywordMatches(searchText, tokenSet, meaningfulFreeTextTokens);

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
          const canFallbackToFuzzyRecall =
            meaningfulFreeTextTokens.length > 0 &&
            fuzzyQueryOverlap >= Math.min(2, meaningfulFreeTextTokens.length);
          if (!canFallbackToFuzzyRecall) {
            return null;
          }
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
        const fuzzyRecallMatched =
          meaningfulFreeTextTokens.length > 0 &&
          fuzzyQueryOverlap >= Math.min(2, meaningfulFreeTextTokens.length);

        if (!disciplineLooksRelated && !fuzzyRecallMatched) {
          return null;
        }
      }

      if (matchedTermCount === 1 && query.major && query.specialization) {
        score += 4;
      }
    }

    if (fuzzyQueryOverlap) {
      score += Math.min(18, fuzzyQueryOverlap * 3);
    }

    if (query.country) score += 12;
    if (query.degree) score += 6;
    score += admissionsCoverageWeight(program);
    score += referenceDataWeight(program);
    score += consultationReadinessWeight(program, query);

    return { program, score };
  })
    .filter((item): item is { program: StudyAbroadFinderProgram; score: number } => Boolean(item))
    .sort((left, right) => {
      const rankOrder = compareProgramsByQsRank(left.program, right.program);
      if (rankOrder !== 0) return rankOrder;
      if (left.score !== right.score) return right.score - left.score;
      return compareProgramNames(left.program, right.program);
    })
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

async function buildStudyAbroadSearchResultFromDb(input: {
  searchSessionId: string;
  query: StudyAbroadResolvedQuery;
  dbResult: StudyAbroadSearchDbResult;
  blocklist: Awaited<ReturnType<typeof readStudyAbroadSearchBlocklist>>;
}) {
  const { searchSessionId, query, dbResult, blocklist } = input;
  const blockedVerifiedHits: Array<{ ruleId: string; label: string; sessionId: string }> = [];
  const pagePrograms: StudyAbroadFinderProgram[] = [];

  dbResult.programs.forEach((program) => {
    const blockedRuleIds = collectBlockedStudyAbroadFinderProgramRuleIds(program, blocklist);
    if (blockedRuleIds.length) {
      const label = `${program.schoolName} / ${program.programName}`.trim();
      blockedRuleIds.forEach((ruleId) => {
        blockedVerifiedHits.push({
          ruleId,
          label,
          sessionId: searchSessionId,
        });
      });
      return;
    }

    pagePrograms.push(program);
  });

  const {
    results: verifiedResults,
    cachedFitCount,
    fitMode,
    filteredByFitModeCount,
    fitSummary,
  } = await prioritizeVerifiedResultsByCachedFit(pagePrograms, query);
  const blockedResultCount = blockedVerifiedHits.length;

  if (blockedResultCount > 0) {
    await recordStudyAbroadSearchAvoidRuleHits({
      hits: blockedVerifiedHits,
    });
  }

  const expansionEnabled = canUseExternalSearch();
  const expansionAttempted = false;
  const pendingReviewCount = 0;
  const candidateResults: SearchWebCandidate[] = [];
  const totalVerifiedCount = dbResult.totalCount;
  const displayedVerifiedCount = verifiedResults.length;
  const totalUniversityCount = dbResult.totalUniversityCount;
  const message = buildSearchMessage({
    query,
    displayedVerifiedCount,
    totalVerifiedCount,
    universityCount: totalUniversityCount,
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
  const searchGuidance = buildSearchGuidance({
    query,
    displayedVerifiedCount,
    totalVerifiedCount,
    universityCount: totalUniversityCount,
    candidateCount: candidateResults.length,
    expansionEnabled,
    expansionAttempted,
    fitMode,
    filteredByFitModeCount,
    blockedResultCount,
    candidateResults,
  });

  await persistStudyAbroadSearchAuditEntry({
    sessionId: searchSessionId,
    query,
    message,
    totalVerifiedCount,
    displayedVerifiedCount,
    totalUniversityCount,
    candidateCount: candidateResults.length,
    pendingReviewCount,
    blockedResultCount,
    results: toAuditResultsFromVerifiedPrograms(verifiedResults),
  });

  return {
    searchSessionId,
    resolvedQuery: query,
    verifiedResults,
    totalVerifiedCount,
    displayedVerifiedCount,
    universityMatches: dbResult.universityMatches,
    totalUniversityCount,
    page: dbResult.page,
    pageSize: dbResult.pageSize,
    totalPages: dbResult.totalPages,
    hasMore: dbResult.hasMore,
    searchBackend: "sqlite",
    candidateResults,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    blockedResultCount,
    message,
    searchGuidance,
  } satisfies StudyAbroadSearchResult;
}

export async function searchStudyAbroadPrograms(
  input: StudyAbroadSearchInput,
  options?: {
    includeExternalCandidates?: boolean;
  }
): Promise<StudyAbroadSearchResult> {
  const searchSessionId = createSearchSessionId(input);
  const query = normalizeStudyAbroadQuery(input);
  const pagination = normalizeSearchPagination(input);
  const includeExternalCandidates = options?.includeExternalCandidates === true;
  const blocklist = await readStudyAbroadSearchBlocklist();
  const dbResult = includeExternalCandidates
    ? null
    : await searchStudyAbroadProgramsFromDb(query, {
        page: pagination.page,
        pageSize: pagination.pageSize,
        universityPage: pagination.universityPage,
        universityPageSize: pagination.universityPageSize,
      });

  if (dbResult) {
    return buildStudyAbroadSearchResultFromDb({
      searchSessionId,
      query,
      dbResult,
      blocklist,
    });
  }

  const sourcePrograms = await readStudyAbroadFinderPrograms();
  const blockedVerifiedHits: Array<{ ruleId: string; label: string; sessionId: string }> = [];
  const filteredSourcePrograms: StudyAbroadFinderProgram[] = [];

  sourcePrograms.forEach((program) => {
    const blockedRuleIds = collectBlockedStudyAbroadFinderProgramRuleIds(program, blocklist);
    if (blockedRuleIds.length) {
      const label = `${program.schoolName} / ${program.programName}`.trim();
      blockedRuleIds.forEach((ruleId) => {
        blockedVerifiedHits.push({
          ruleId,
          label,
          sessionId: searchSessionId,
        });
      });
      return;
    }

    filteredSourcePrograms.push(program);
  });
  const blockedVerifiedCount = blockedVerifiedHits.length;
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
  const totalPages = totalPagesFor(allVerifiedResults.length, pagination.pageSize);
  const verifiedResults = allVerifiedResults.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize
  );
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
  const shouldExpand =
    includeExternalCandidates &&
    shouldRunExternalSearch(query, verifiedResults) &&
    expansionEnabled;
  let pendingReviewCount = 0;
  let expansionAttempted = false;
  let candidateResults: SearchWebCandidate[] = [];
  let searchGuidance: StudyAbroadSearchGuidance;

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
    if (blockedResultCount > 0) {
      await recordStudyAbroadSearchAvoidRuleHits({
        hits: [...blockedVerifiedHits, ...candidateSearch.blockedRuleHits.map((item) => ({
          ...item,
          sessionId: searchSessionId,
        }))],
      });
    }

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
    searchGuidance = buildSearchGuidance({
      query,
      displayedVerifiedCount: verifiedResults.length,
      totalVerifiedCount: allVerifiedResults.length,
      universityCount: allUniversityMatches.length,
      candidateCount: candidateResults.length,
      expansionEnabled,
      expansionAttempted,
      fitMode,
      filteredByFitModeCount,
      blockedResultCount,
      candidateResults,
    });

    await persistStudyAbroadSearchAuditEntry({
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
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages,
      hasMore: pagination.page < totalPages,
      searchBackend: "json",
      candidateResults,
      expansionEnabled,
      expansionAttempted,
      pendingReviewCount,
      blockedResultCount,
      message,
      searchGuidance,
    };
  }

  const blockedResultCount = blockedVerifiedCount;
  if (blockedResultCount > 0) {
    await recordStudyAbroadSearchAvoidRuleHits({
      hits: blockedVerifiedHits,
    });
  }

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
  searchGuidance = buildSearchGuidance({
    query,
    displayedVerifiedCount: verifiedResults.length,
    totalVerifiedCount: allVerifiedResults.length,
    universityCount: allUniversityMatches.length,
    candidateCount: candidateResults.length,
    expansionEnabled,
    expansionAttempted,
    fitMode,
    filteredByFitModeCount,
    blockedResultCount,
    candidateResults,
  });

  await persistStudyAbroadSearchAuditEntry({
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
    page: pagination.page,
    pageSize: pagination.pageSize,
    totalPages,
    hasMore: pagination.page < totalPages,
    searchBackend: "json",
    candidateResults,
    expansionEnabled,
    expansionAttempted,
    pendingReviewCount,
    blockedResultCount,
    message,
    searchGuidance,
  };
}

export async function expandStudyAbroadSearchCandidates(
  input: StudyAbroadSearchInput
): Promise<StudyAbroadSearchExpansionResult> {
  const searchSessionId = createSearchSessionId(input);
  const query = normalizeStudyAbroadQuery(input);
  const expansionEnabled = canUseExternalSearch();

  if (!expansionEnabled || !shouldRunExternalSearch(query, [])) {
    const emptyGuidance = buildSearchGuidance({
      query,
      displayedVerifiedCount: 0,
      totalVerifiedCount: 0,
      universityCount: 0,
      candidateCount: 0,
      expansionEnabled,
      expansionAttempted: false,
      fitMode: query.fitMode,
      filteredByFitModeCount: 0,
      blockedResultCount: 0,
      candidateResults: [],
    });
    return {
      searchSessionId,
      resolvedQuery: query,
      candidateResults: [],
      expansionEnabled,
      expansionAttempted: false,
      pendingReviewCount: 0,
      blockedResultCount: 0,
      message: "",
      searchGuidance: emptyGuidance,
    };
  }

  const [sourcePrograms, blocklist] = await Promise.all([
    readStudyAbroadFinderPrograms(),
    readStudyAbroadSearchBlocklist(),
  ]);
  const blockedVerifiedHits: Array<{ ruleId: string; label: string; sessionId: string }> = [];
  const filteredSourcePrograms: StudyAbroadFinderProgram[] = [];
  sourcePrograms.forEach((program) => {
    const blockedRuleIds = collectBlockedStudyAbroadFinderProgramRuleIds(program, blocklist);
    if (blockedRuleIds.length) {
      const label = `${program.schoolName} / ${program.programName}`.trim();
      blockedRuleIds.forEach((ruleId) => {
        blockedVerifiedHits.push({
          ruleId,
          label,
          sessionId: searchSessionId,
        });
      });
      return;
    }

    filteredSourcePrograms.push(program);
  });
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
    blockedVerifiedHits.length +
    candidateSearch.blockedCount;
  if (blockedResultCount > 0) {
    await recordStudyAbroadSearchAvoidRuleHits({
      hits: [...blockedVerifiedHits, ...candidateSearch.blockedRuleHits.map((item) => ({
        ...item,
        sessionId: searchSessionId,
      }))],
    });
  }

  const message =
    candidateResults.length > 0
      ? pendingReviewCount
        ? `后台已补充 ${candidateResults.length} 条候选官网页，并同步到审核队列。`
        : `后台已补充 ${candidateResults.length} 条候选官网页。`
      : "后台候选官网页扩展未补充到更高质量结果。";
  const searchGuidance = buildSearchGuidance({
    query,
    displayedVerifiedCount: verifiedResults.length,
    totalVerifiedCount: verifiedResults.length,
    universityCount: 0,
    candidateCount: candidateResults.length,
    expansionEnabled,
    expansionAttempted: true,
    fitMode: query.fitMode,
    filteredByFitModeCount: 0,
    blockedResultCount,
    candidateResults,
  });

  await persistStudyAbroadSearchAuditEntry({
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
    searchGuidance,
  };
}

function buildSearchGuidance(params: {
  query: ReturnType<typeof normalizeStudyAbroadQuery>;
  displayedVerifiedCount: number;
  totalVerifiedCount: number;
  universityCount: number;
  candidateCount: number;
  expansionEnabled: boolean;
  expansionAttempted: boolean;
  fitMode: string;
  filteredByFitModeCount: number;
  blockedResultCount: number;
  candidateResults: SearchWebCandidate[];
}) {
  const {
    query,
    displayedVerifiedCount,
    totalVerifiedCount,
    candidateCount,
    expansionEnabled,
    expansionAttempted,
    fitMode,
    filteredByFitModeCount,
    blockedResultCount,
    candidateResults,
  } = params;

  const intentSignals = [
    query.freeText ? "已识别一句话需求" : "",
    query.country ? `国家锁定：${query.country}` : "",
    query.degree ? `学位锁定：${query.degree}` : "",
    query.major ? `专业方向：${query.major}` : "",
    query.specialization ? `细分方向：${query.specialization}` : "",
    query.intake ? `入学季：${query.intake}` : "",
    query.budgetTier ? `预算筛选已开启` : "",
    query.gpaProfile ? `GPA 已参与排序` : "",
    query.languageProfile ? `语言成绩已参与排序` : "",
  ].filter(Boolean);

  const rankingSignals = [
    "专业匹配优先",
    "门槛完整度优先",
    "官网可核验度优先",
    query.gpaProfile || query.languageProfile ? "背景匹配仅作排序参考" : "",
    blockedResultCount ? `已自动跳过 ${blockedResultCount} 条后台规避结果` : "",
  ].filter(Boolean);

  const candidateHigh = candidateResults.filter((item) => item.credibilityLevel === "high").length;
  const candidateMedium = candidateResults.filter((item) => item.credibilityLevel === "medium").length;
  const candidateWatch = candidateResults.filter((item) => item.credibilityLevel === "watch").length;
  const candidateQualitySummary = candidateCount
    ? `候选官网页中，高可信 ${candidateHigh} 条，中可信 ${candidateMedium} 条，待人工核对 ${candidateWatch} 条。`
    : expansionEnabled
      ? "当前没有补充到可展示的候选官网页。"
      : "当前站点还没有启用全网候选扩搜。";

  let failureReasonCode = "ok";
  let failureReason = totalVerifiedCount
    ? `当前已命中 ${totalVerifiedCount} 条正式项目，可以优先看前排结果。`
    : "";
  const nextSteps: string[] = [];

  if (!totalVerifiedCount) {
    if (filteredByFitModeCount > 0 && fitMode && fitMode !== "prefer") {
      failureReasonCode = "fit-mode-too-strict";
      failureReason = "当前背景策略把原本能看的项目进一步筛掉了。";
      nextSteps.push("先切回“推荐排序”，再结合项目卡里的背景提示继续判断。");
    } else if (query.specialization) {
      failureReasonCode = "specialization-too-narrow";
      failureReason = "细分方向过窄，正式项目库里暂时没有完全对齐的结果。";
      nextSteps.push("先去掉细分方向，保留国家、学位和专业大方向重新搜索。");
    } else if (query.budgetTier || query.intake) {
      failureReasonCode = "hard-filters-too-strict";
      failureReason = "预算或入学季把结果筛得太窄了。";
      nextSteps.push("先放宽预算或入学季，再看正式结果会不会恢复。");
    } else if (candidateCount > 0) {
      failureReasonCode = "catalog-thin-candidates-available";
      failureReason = "正式库还比较薄，但全网已经找到了可补充的候选官网页。";
      nextSteps.push("先参考高可信候选官网页，再由后台导入正式项目。");
    } else if (!expansionEnabled) {
      failureReasonCode = "external-search-disabled";
      failureReason = "当前站点还没有启用全网候选扩搜，只能依赖正式库。";
      nextSteps.push("建议先接通全网扩搜，再放宽国家或专业方向。");
    } else if (expansionAttempted) {
      failureReasonCode = "no-reliable-candidates";
      failureReason = "这轮没有找到正式结果，也没有筛出足够可靠的候选官网页。";
      nextSteps.push("建议先放宽国家或专业方向，再重试这轮搜索。");
    } else {
      failureReasonCode = "catalog-coverage-thin";
      failureReason = "正式项目库覆盖暂时不足，当前条件下没有命中结果。";
      nextSteps.push("建议先放宽专业方向，或改成更宽的国家 / 学位组合。");
    }
  } else if (displayedVerifiedCount <= 5) {
    failureReasonCode = "low-result";
    failureReason = "当前正式结果偏少，前排项目值得看，但建议同时放宽一层方向。";
    nextSteps.push("优先查看前 3 个正式项目，再试试系统给出的放宽建议。");
  } else {
    nextSteps.push("优先查看前 3 到 5 个正式项目，再决定是否需要继续放宽方向。");
  }

  if (candidateCount && candidateWatch > candidateHigh) {
    nextSteps.push("候选页里待人工核对项偏多，建议优先看高可信来源。");
  }

  return {
    failureReason,
    failureReasonCode,
    nextSteps: Array.from(new Set(nextSteps)).slice(0, 3),
    intentSignals: Array.from(new Set(intentSignals)).slice(0, 6),
    rankingSignals: Array.from(new Set(rankingSignals)).slice(0, 5),
    candidateQualitySummary,
  };
}

function selectCandidatesForReviewQueue(candidates: SearchWebCandidate[]) {
  return candidates.slice(0, MAX_REVIEW_QUEUE_CANDIDATES).map((candidate) => ({
    title: candidate.title,
    link: candidate.link,
    displayLink: candidate.displayLink,
    snippet: candidate.snippet,
    provider: candidate.provider,
    date: candidate.date,
    authorityScore: candidate.authorityScore,
    rerankScore: candidate.rerankScore,
    score: candidate.score,
    credibilityLevel: candidate.credibilityLevel,
    credibilityLabel: candidate.credibilityLabel,
    credibilityReason: candidate.credibilityReason,
    relevanceSignals: candidate.relevanceSignals,
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
    if (query.degree === "高中" || query.degree === "本科" || query.degree === "博士") {
      return withGovernanceNote(
        `当前学校底库已经支持按国家先筛学校，但 ${query.degree} 项目层还在持续补充，建议先浏览学校池，或放宽国家和方向条件。`
      );
    }

    return withGovernanceNote(
      "当前项目库里没有完全匹配结果，且站点还未配置百度搜索 API。建议先放宽专业词，或补充百度 AppBuilder API Key。"
    );
  }

  if (candidateCount) {
    if (query.degree === "高中" || query.degree === "本科" || query.degree === "博士") {
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

  if (query.degree === "高中" || query.degree === "本科" || query.degree === "博士") {
    return withGovernanceNote(
      `当前学校底库已经支持按国家先筛学校，但 ${query.degree} 项目层还在持续补充。可以先浏览学校池，或放宽国家和方向条件。${hardFilterNote}${snapshotNote}${fitModeNote}${fitCacheNote}${advisoryNote}`.trim()
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
      model: BAIDU_SEARCH_MODEL,
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
        credibilityLevel: "watch",
        credibilityLabel: "",
        credibilityReason: "",
        relevanceSignals: [],
      } satisfies SearchWebCandidate;

      return {
        ...candidate,
        score: scoreCandidate(candidate, normalizedQuery),
      };
    })
    .filter((candidate) => Number(candidate.score ?? 0) >= MIN_CANDIDATE_SCORE).length;

  const fallbackCandidateCount = candidateCount
    ? 0
    : (
        await buildCatalogOfficialFallbackCandidates(
          normalizedQuery,
          [],
          new Set<string>()
        )
      ).length;
  const effectiveCandidateCount = candidateCount || fallbackCandidateCount;
  const ok = rawWebReferences.length > 0 || effectiveCandidateCount > 0;

  return {
    status,
    probe: {
      attempted: true,
      ok,
      query: probeQuery,
      rawReferenceCount: rawWebReferences.length,
      candidateCount: effectiveCandidateCount,
      message: ok
        ? rawWebReferences.length > 0
          ? `探测成功，返回 ${rawWebReferences.length} 条原始参考，${effectiveCandidateCount} 条通过候选筛选。`
          : `探测请求已发起，百度暂未返回参考；已启用官方院校官网保底候选，当前可生成 ${effectiveCandidateCount} 条候选。`
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
      [program.overviewUrl, program.admissionsUrl].filter((item): item is string => Boolean(item))
    )
  );

  if (!baiduApiKey) {
    return {
      candidates: [],
      blockedCount: 0,
      blockedRuleHits: [],
    };
  }

  const resultSets = await Promise.all(
    queries.map((item) => searchBaiduCandidates(item, baiduApiKey, query))
  );

  const catalogFallbackCandidates = await buildCatalogOfficialFallbackCandidates(
    query,
    verifiedResults,
    verifiedLinks
  );
  const dedupedCandidates = dedupeCandidates([
    ...resultSets.flat(),
    ...catalogFallbackCandidates,
  ]).filter(
    (candidate) => !verifiedLinks.has(candidate.link)
  );
  let blockedCount = 0;
  const blockedRuleHits: Array<{ ruleId: string; label: string }> = [];
  const candidates: SearchWebCandidate[] = [];

  dedupedCandidates.forEach((candidate) => {
    const blockedRuleIds = collectBlockedStudyAbroadCandidateRuleIds(candidate, blocklist);
    if (blockedRuleIds.length) {
      blockedCount += 1;
      const label = candidate.title || candidate.displayLink || candidate.link;
      blockedRuleIds.forEach((ruleId) => {
        blockedRuleHits.push({
          ruleId,
          label,
        });
      });
      return;
    }

    if (candidates.length < MAX_CANDIDATE_RESULTS) {
      candidates.push(candidate);
    }
  });

  return {
    candidates,
    blockedCount,
    blockedRuleHits,
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
      model: BAIDU_SEARCH_MODEL,
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
        credibilityLevel: "watch",
        credibilityLabel: "",
        credibilityReason: "",
        relevanceSignals: [],
      } satisfies SearchWebCandidate;

      const scored = {
        ...candidate,
        score: scoreCandidate(candidate, query),
      };

      return enrichCandidateCredibility(scored, query);
    })
    .filter((candidate: SearchWebCandidate) => Number(candidate.score ?? 0) >= MIN_CANDIDATE_SCORE);
}

async function buildCatalogOfficialFallbackCandidates(
  query: ReturnType<typeof normalizeStudyAbroadQuery>,
  verifiedResults: StudyAbroadFinderProgram[],
  verifiedLinks: Set<string>
) {
  if (!query.country) {
    return [];
  }

  const universities = await readStudyAbroadCatalogUniversities();
  const verifiedUniversityIds = new Set(
    verifiedResults.map((program) => program.universityId).filter(Boolean)
  );
  const queryText = [
    query.country,
    query.major,
    query.specialization,
    query.degree || "硕士",
    "admissions",
    "program",
  ]
    .filter(Boolean)
    .join(" ");

  return universities
    .filter((university) => university.country === query.country && university.officialWebsite)
    .sort((left, right) => {
      const leftVerified = verifiedUniversityIds.has(left.id) ? 0 : 1;
      const rightVerified = verifiedUniversityIds.has(right.id) ? 0 : 1;
      if (leftVerified !== rightVerified) return leftVerified - rightVerified;

      const leftRank = Number.isFinite(left.qsRank ?? NaN) && (left.qsRank ?? 0) > 0
        ? (left.qsRank ?? 999999)
        : 999999;
      const rightRank = Number.isFinite(right.qsRank ?? NaN) && (right.qsRank ?? 0) > 0
        ? (right.qsRank ?? 999999)
        : 999999;

      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.name.localeCompare(right.name, "en-US");
    })
    .map((university) => {
      const link = university.officialWebsite.trim();
      const displayLink = university.websiteDomain || (() => {
        try {
          return new URL(link).hostname;
        } catch {
          return link;
        }
      })();
      const candidate = {
        title: `${university.nameZh || university.name} 官方官网入口 / ${query.major || "研究生项目"} ${query.degree || "硕士"}`,
        link,
        displayLink,
        snippet: `${university.name} official university website. 用于在百度扩搜无结果时保底核对 ${queryText}，后台导入前仍需打开官网确认具体项目页。`,
        provider: "Official Catalog Fallback",
        date: "",
        authorityScore: 0.72,
        rerankScore: 0.62,
        score: 68,
        credibilityLevel: "high",
        credibilityLabel: "高可信",
        credibilityReason: "来自已校验学校官网入口；适合作为官网抓取和人工核对的保底候选。",
        relevanceSignals: ["院校官网", "国家匹配", query.degree ? "学位匹配" : "", query.major ? "专业待核对" : ""].filter(Boolean),
      } satisfies SearchWebCandidate;

      return candidate;
    })
    .filter((candidate) => candidate.link && !verifiedLinks.has(candidate.link))
    .slice(0, MAX_CANDIDATE_RESULTS);
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

function enrichCandidateCredibility(
  candidate: SearchWebCandidate,
  query: ReturnType<typeof normalizeStudyAbroadQuery>
) {
  let level: StudyAbroadSearchCandidateResult["credibilityLevel"] = "watch";
  let label = "待核对";
  let reason = "来源和内容需要后台继续核对后再导入正式项目。";
  const signals: string[] = [];

  let url: URL | null = null;
  try {
    url = candidate.link ? new URL(candidate.link) : null;
  } catch {
    url = null;
  }

  const host = url?.hostname.toLowerCase() || "";
  const academicHost = Boolean(host && hostLooksAcademic(host));
  const official = isOfficialCandidate(candidate);
  const text = normalizeText([candidate.title, candidate.displayLink, candidate.snippet].join(" "));

  if (official) {
    level = "high";
    label = "高可信";
    reason = "看起来像院校官网或学术域名下的招生 / 项目页，优先级最高。";
    signals.push("院校官网");
  } else if (academicHost || (candidate.authorityScore ?? 0) >= 0.65) {
    level = "medium";
    label = "中可信";
    reason = "来源更接近学校域名或权威站点，但仍建议人工核对项目页面。";
    signals.push("学术域名");
  }

  if (textHasAlias(text, query.country, COUNTRY_QUERY_ALIASES) || guessCountryFromHost(host) === query.country) {
    signals.push("国家匹配");
  }

  if (textHasAlias(text, query.degree, DEGREE_QUERY_ALIASES)) {
    signals.push("学位匹配");
  }

  if (textHasAlias(text, query.major, MAJOR_QUERY_ALIASES)) {
    signals.push("专业匹配");
  }

  if (textHasAlias(text, query.specialization, SPECIALIZATION_QUERY_ALIASES)) {
    signals.push("细分方向匹配");
  }

  return {
    ...candidate,
    credibilityLevel: level,
    credibilityLabel: label,
    credibilityReason: reason,
    relevanceSignals: Array.from(new Set(signals)).slice(0, 4),
  };
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
