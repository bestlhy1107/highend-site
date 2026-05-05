import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  readStudyAbroadCatalogPrograms,
  writeStudyAbroadCatalogPrograms,
  type StudyAbroadCatalogAdmissionsSnapshot,
  type StudyAbroadCatalogProgram,
} from "./study-abroad-catalog-store";
import { readStudyAbroadAdmissionsInsight } from "./study-abroad-admissions";
import { dataFilePath } from "./json-file-store";
import {
  MAJOR_FAMILIES,
  MAJOR_QUERY_ALIASES,
  SPECIALIZATION_QUERY_ALIASES,
} from "./study-abroad-programs";

const ADMISSIONS_SYNC_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const DEFAULT_MAX_PROGRAMS = 12;
const MAX_PROGRAMS = 40;
const CONCURRENCY = 2;
const PREFETCH_MAX_PROGRAMS = 8;
const IN_FLIGHT_PROGRAM_IDS = new Set<string>();
const WARMUP_STATE_FILE = "study-abroad-admissions-warmup-state.json";
const CAMPAIGN_STATE_FILE = "study-abroad-admissions-campaign-state.json";
const STRATEGY_FILE = "study-abroad-admissions-strategy.json";
const DEFAULT_COUNTRY_TARGET = {
  targetStructuredCoveragePercent: 18,
  strategicPriority: 1,
  note: "常规国家先保证基础结构化门槛覆盖，再逐步往细分方向补厚。",
} as const;
const STUDY_ABROAD_COUNTRY_TARGETS = [
  {
    country: "美国",
    targetStructuredCoveragePercent: 12,
    strategicPriority: 1,
    note: "美国项目盘子已经很大，先守住基础覆盖，再把热门方向继续补厚。",
  },
  {
    country: "英国",
    targetStructuredCoveragePercent: 30,
    strategicPriority: 4,
    note: "英国项目层还在扩张期，先把硕士主流方向拉到可稳定比对的水平。",
  },
  {
    country: "加拿大",
    targetStructuredCoveragePercent: 28,
    strategicPriority: 4,
    note: "加拿大适合尽快补到能稳定筛专业、看门槛的覆盖线。",
  },
  {
    country: "澳大利亚",
    targetStructuredCoveragePercent: 28,
    strategicPriority: 4,
    note: "澳洲项目结构相对规整，适合优先补出一批可直接对比的门槛快照。",
  },
  {
    country: "中国香港",
    targetStructuredCoveragePercent: 35,
    strategicPriority: 5,
    note: "香港项目量不算大，但转化价值高，适合优先拉高结构化覆盖率。",
  },
  {
    country: "新加坡",
    targetStructuredCoveragePercent: 35,
    strategicPriority: 5,
    note: "新加坡学校数少但关注度高，适合优先把关键项目补到位。",
  },
  {
    country: "德国",
    targetStructuredCoveragePercent: 24,
    strategicPriority: 3,
    note: "德国先以高频英文授课项目为主，逐步把基础门槛补起来。",
  },
] as const;
const ADMISSIONS_WARMUP_PRESETS = [
  {
    id: "us-cs-master",
    label: "美国 · 计算机 / AI · 硕士",
    description: "优先预热美国计算机、AI、人机交互这批高频硕士项目。",
    country: "美国",
    degree: "硕士",
    major: "计算机 / AI",
    maxPrograms: 8,
  },
  {
    id: "us-finance-master",
    label: "美国 · 金融 · 硕士",
    description: "优先补齐金融工程、量化金融、投资管理这批热门美国项目。",
    country: "美国",
    degree: "硕士",
    major: "金融",
    maxPrograms: 8,
  },
  {
    id: "uk-business-master",
    label: "英国 · 商科 / 管理 · 硕士",
    description: "优先补英国商科、管理、商业分析这批前排硕士项目。",
    country: "英国",
    degree: "硕士",
    major: "商科 / 管理",
    maxPrograms: 6,
  },
  {
    id: "uk-cs-master",
    label: "英国 · 计算机 / AI · 硕士",
    description: "优先补英国计算机、数据和软件相关硕士项目。",
    country: "英国",
    degree: "硕士",
    major: "计算机 / AI",
    maxPrograms: 6,
  },
  {
    id: "hk-finance-master",
    label: "中国香港 · 金融 · 硕士",
    description: "优先补香港金融和量化方向的硕士项目。",
    country: "中国香港",
    degree: "硕士",
    major: "金融",
    maxPrograms: 5,
  },
  {
    id: "sg-cs-master",
    label: "新加坡 · 计算机 / AI · 硕士",
    description: "优先补新加坡计算机与数据方向硕士项目。",
    country: "新加坡",
    degree: "硕士",
    major: "计算机 / AI",
    maxPrograms: 4,
  },
] as const;

type SyncMode = "missing-first" | "refresh-all";
type AdmissionsSyncOptions = {
  maxPrograms?: number;
  mode?: string;
  country?: string;
  degree?: string;
  major?: string;
  specialization?: string;
  programIds?: string[];
  recordHistory?: boolean;
};
export type StudyAbroadAdmissionsWarmupPreset = (typeof ADMISSIONS_WARMUP_PRESETS)[number];
export type StudyAbroadAdmissionsCountryTarget = {
  country: string;
  targetStructuredCoveragePercent: number;
  strategicPriority: number;
  note: string;
};
export type StudyAbroadAdmissionsCountryTargetStatus = StudyAbroadAdmissionsCountryTarget & {
  totalPrograms: number;
  syncedPrograms: number;
  structuredPrograms: number;
  completePrograms: number;
  missingPrograms: number;
  syncedCoveragePercent: number;
  structuredCoveragePercent: number;
  completeCoveragePercent: number;
  targetGapPercent: number;
  targetProgramGap: number;
  status: "reached" | "progressing" | "behind";
};
export type StudyAbroadAdmissionsCountryTargetFocusRecommendation = {
  id: string;
  label: string;
  description: string;
  country: string;
  degree: string;
  major: string;
  specialization: string;
  totalPrograms: number;
  syncedPrograms: number;
  structuredPrograms: number;
  completePrograms: number;
  missingPrograms: number;
  structuredCoveragePercent: number;
  gapScore: number;
  recommendationScore: number;
  missingGapScore: number;
  structuredGapScore: number;
  completeGapScore: number;
  targetGapScore: number;
  priorityScore: number;
  volumeScore: number;
  recencyBoostScore: number;
  recencyPenaltyScore: number;
  maxPrograms: number;
  lastRecommendationRunAt: string;
  lastRecommendationRunDays: number;
  lastRecommendationRunLabel: string;
  recentlyRun: boolean;
  coolingDown: boolean;
  cooldownHours: number;
  cooldownRemainingHours: number;
  coolingDownUntil: string;
};
export type StudyAbroadAdmissionsCountryTargetPlan =
  StudyAbroadAdmissionsCountryTargetStatus & {
    focusRecommendations: StudyAbroadAdmissionsCountryTargetFocusRecommendation[];
  };
export type StudyAbroadAdmissionsCountryTargetQueueItem =
  StudyAbroadAdmissionsCountryTargetPlan & {
    queueScore: number;
    lastCountryRunAt: string;
    lastCountryRunDays: number;
  };
export type StudyAbroadAdmissionsCoverageSnapshot = {
  totalPrograms: number;
  syncedPrograms: number;
  structuredPrograms: number;
  completePrograms: number;
  syncedCoveragePercent: number;
  structuredCoveragePercent: number;
  completeCoveragePercent: number;
};
export type StudyAbroadAdmissionsCoverageSprintItem = {
  id: string;
  source: "country-target" | "smart";
  label: string;
  description: string;
  reason: string;
  country: string;
  degree: string;
  major: string;
  specialization: string;
  maxPrograms: number;
};
export type StudyAbroadAdmissionsCoverageSprintPlan = {
  degree: string;
  items: StudyAbroadAdmissionsCoverageSprintItem[];
  estimatedPrograms: number;
  countries: string[];
  summary: string;
};
export type StudyAbroadAdmissionsCoverageSprintDelta = {
  overall: {
    before: StudyAbroadAdmissionsCoverageSnapshot;
    after: StudyAbroadAdmissionsCoverageSnapshot;
    syncedDelta: number;
    structuredDelta: number;
    completeDelta: number;
  };
  countries: Array<{
    country: string;
    before: StudyAbroadAdmissionsCoverageSnapshot;
    after: StudyAbroadAdmissionsCoverageSnapshot;
    syncedDelta: number;
    structuredDelta: number;
    completeDelta: number;
  }>;
};
export type StudyAbroadAdmissionsCoverageGoalSummary = {
  degree: string;
  totalPrograms: number;
  keyCountries: number;
  currentStructuredPrograms: number;
  targetStructuredPrograms: number;
  remainingStructuredPrograms: number;
  currentCoveragePercent: number;
  targetCoveragePercent: number;
  countries: StudyAbroadAdmissionsCountryTargetStatus[];
};
export type StudyAbroadAdmissionsCoverageSprintRoadmapRound = {
  round: number;
  plan: StudyAbroadAdmissionsCoverageSprintPlan;
};
export type StudyAbroadAdmissionsCoverageRoadmapRun = {
  round: number;
  plan: StudyAbroadAdmissionsCoverageSprintPlan;
  syncedCount: number;
  okCount: number;
  partialCount: number;
  unavailableCount: number;
  delta: StudyAbroadAdmissionsCoverageSprintDelta["overall"];
  countryDelta: StudyAbroadAdmissionsCoverageSprintDelta["countries"];
};
export type StudyAbroadAdmissionsCampaignCountryBreakdown = {
  country: string;
  structuredDelta: number;
  completeDelta: number;
};
export type StudyAbroadAdmissionsCampaignFocusBreakdown = {
  id: string;
  label: string;
  country: string;
  major: string;
  specialization: string;
  syncedCount: number;
  okCount: number;
  partialCount: number;
  unavailableCount: number;
  structuredDelta: number;
  completeDelta: number;
};
export type StudyAbroadAdmissionsCampaignRun = {
  runAt: string;
  mode: "sprint" | "roadmap";
  degree: string;
  rounds: number;
  itemCount: number;
  countries: string[];
  syncedCount: number;
  okCount: number;
  partialCount: number;
  unavailableCount: number;
  structuredDelta: number;
  completeDelta: number;
  countryBreakdown: StudyAbroadAdmissionsCampaignCountryBreakdown[];
  focusBreakdown: StudyAbroadAdmissionsCampaignFocusBreakdown[];
};
export type StudyAbroadAdmissionsCampaignState = {
  updatedAt: string;
  runs: StudyAbroadAdmissionsCampaignRun[];
};
export type StudyAbroadAdmissionsCampaignOutlook = {
  degree: string;
  goal: StudyAbroadAdmissionsCoverageGoalSummary;
  recentRuns: StudyAbroadAdmissionsCampaignRun[];
  averageStructuredDelta: number;
  averageCompleteDelta: number;
  averageSyncedCount: number;
  estimatedRunsToTarget: number | null;
  suggestedRhythm: "steady" | "accelerate" | "precision";
  summary: string;
};
export type StudyAbroadAdmissionsCampaignCadence = {
  degree: string;
  rhythm: "steady" | "accelerate" | "precision";
  label: string;
  description: string;
  rounds: number;
  maxCountries: number;
  maxFocusPerCountry: number;
  maxRecommendations: number;
  suggestedRunsPerWeek: number;
};
export type StudyAbroadAdmissionsCampaignSchedule = {
  degree: string;
  cadence: StudyAbroadAdmissionsCampaignCadence;
  weekdayLabels: string[];
  hour: number;
  minute: number;
  frequencyLabel: string;
  nextRunAt: string;
  nextRunLabel: string;
  command: string;
  suggestedAutomationName: string;
};
export type StudyAbroadAdmissionsCampaignTrendDay = {
  date: string;
  label: string;
  runCount: number;
  syncedCount: number;
  structuredDelta: number;
  completeDelta: number;
  countries: string[];
};
export type StudyAbroadAdmissionsCampaignTrend = {
  degree: string;
  days: StudyAbroadAdmissionsCampaignTrendDay[];
  totals: {
    runCount: number;
    syncedCount: number;
    structuredDelta: number;
    completeDelta: number;
  };
  hasActivity: boolean;
};
export type StudyAbroadAdmissionsCampaignCountryTrendItem = {
  country: string;
  runCount: number;
  activeDays: number;
  structuredDelta: number;
  completeDelta: number;
  lastRunAt: string;
  lastRunLabel: string;
};
export type StudyAbroadAdmissionsCampaignCountryTrend = {
  degree: string;
  days: number;
  countries: StudyAbroadAdmissionsCampaignCountryTrendItem[];
  hasActivity: boolean;
};
export type StudyAbroadAdmissionsCampaignCountryFocusTrendFocus = {
  id: string;
  label: string;
  major: string;
  specialization: string;
  runCount: number;
  syncedCount: number;
  okCount: number;
  structuredDelta: number;
  completeDelta: number;
};
export type StudyAbroadAdmissionsCampaignCountryFocusTrendItem = {
  country: string;
  focuses: StudyAbroadAdmissionsCampaignCountryFocusTrendFocus[];
};
export type StudyAbroadAdmissionsCampaignCountryFocusTrend = {
  degree: string;
  days: number;
  countries: StudyAbroadAdmissionsCampaignCountryFocusTrendItem[];
  hasActivity: boolean;
};
export type StudyAbroadAdmissionsCountryRecentActivityItem = {
  country: string;
  runAt: string;
  runAtLabel: string;
  mode: "preset" | "smart" | "sprint" | "direct";
  label: string;
  labels: string[];
  syncedCount: number;
  okCount: number;
  partialCount: number;
  unavailableCount: number;
};
export type StudyAbroadAdmissionsStrategy = {
  focusCooldownHours: number;
  countryCooldownHours: number;
  smartRecommendationCooldownHours: number;
};
export type StudyAbroadAdmissionsStrategyPreset = {
  id: string;
  label: string;
  description: string;
  strategy: StudyAbroadAdmissionsStrategy;
};
export type StudyAbroadAdmissionsWarmupRecommendation = {
  id: string;
  label: string;
  description: string;
  country: string;
  degree: string;
  major: string;
  specialization: string;
  totalPrograms: number;
  syncedPrograms: number;
  structuredPrograms: number;
  completePrograms: number;
  missingPrograms: number;
  gapScore: number;
  smartScore: number;
  targetBoostScore: number;
  freshnessBoostScore: number;
  countryFreshnessBoostScore: number;
  recommendationPenaltyScore: number;
  countryPenaltyScore: number;
  maxPrograms: number;
  countryStructuredCoveragePercent: number;
  countryTargetCoveragePercent: number;
  countryTargetGapPercent: number;
  countryTargetProgramGap: number;
  countryStrategicPriority: number;
  countryTargetNote: string;
};
export type StudyAbroadAdmissionsWarmupState = {
  updatedAt: string;
  lastRecommendationRuns: Record<string, string>;
  lastCountryRuns: Record<string, string>;
  history: Array<{
    runAt: string;
    mode: "preset" | "smart" | "sprint" | "direct";
    recommendationId: string;
    country: string;
    label: string;
    syncedCount: number;
    okCount: number;
    partialCount: number;
    unavailableCount: number;
  }>;
};

const DEFAULT_WARMUP_STATE: StudyAbroadAdmissionsWarmupState = {
  updatedAt: "",
  lastRecommendationRuns: {},
  lastCountryRuns: {},
  history: [],
};
const DEFAULT_CAMPAIGN_STATE: StudyAbroadAdmissionsCampaignState = {
  updatedAt: "",
  runs: [],
};
const DEFAULT_STRATEGY: StudyAbroadAdmissionsStrategy = {
  focusCooldownHours: 24,
  countryCooldownHours: 12,
  smartRecommendationCooldownHours: 72,
};
const STRATEGY_PRESETS: StudyAbroadAdmissionsStrategyPreset[] = [
  {
    id: "conservative",
    label: "保守",
    description: "更看重稳定性，避免短时间内反复命中同一国家和方向。",
    strategy: {
      focusCooldownHours: 48,
      countryCooldownHours: 24,
      smartRecommendationCooldownHours: 120,
    },
  },
  {
    id: "balanced",
    label: "平衡",
    description: "兼顾推进速度和分散度，适合作为日常默认节奏。",
    strategy: { ...DEFAULT_STRATEGY },
  },
  {
    id: "aggressive",
    label: "激进",
    description: "更快回补高缺口方向，适合短期冲刺拉覆盖率。",
    strategy: {
      focusCooldownHours: 8,
      countryCooldownHours: 4,
      smartRecommendationCooldownHours: 24,
    },
  },
];

function normalizeSyncMode(value: string): SyncMode {
  return value === "refresh-all" ? "refresh-all" : "missing-first";
}

function isFreshSnapshot(snapshot: StudyAbroadCatalogAdmissionsSnapshot | null | undefined) {
  const extractedAt = new Date(String(snapshot?.extractedAt ?? "")).getTime();
  return Boolean(extractedAt) && Date.now() - extractedAt <= ADMISSIONS_SYNC_TTL_MS;
}

function snapshotNeedsRefresh(
  program: StudyAbroadCatalogProgram,
  mode: SyncMode
) {
  if (mode === "refresh-all") {
    return true;
  }

  return !isFreshSnapshot(program.admissionsSnapshot ?? null);
}

function normalizeLookupText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesSearchToken(source: string, token: string) {
  const normalizedSource = normalizeLookupText(source);
  const normalizedToken = normalizeLookupText(token);
  return Boolean(normalizedSource && normalizedToken && normalizedSource.includes(normalizedToken));
}

function slugifyRecommendationPart(value: string) {
  return normalizeLookupText(value).replace(/\s+/g, "-");
}

function toCoveragePercent(covered: number, total: number) {
  return total > 0 ? Math.round((covered / total) * 100) : 0;
}

function toTimestamp(value: string | undefined) {
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysSince(value: string | undefined) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60 * 24));
}

function hoursSince(value: string | undefined) {
  const timestamp = toTimestamp(value);
  if (!timestamp) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.now() - timestamp) / (1000 * 60 * 60));
}

function formatLocalDateTime(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addHours(dateLike: string | Date, hours: number) {
  const base = typeof dateLike === "string" ? new Date(dateLike) : new Date(dateLike);
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

function buildAdmissionsSyncHistoryId(options?: AdmissionsSyncOptions) {
  const country = String(options?.country ?? "").trim();
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const major = String(options?.major ?? "").trim();
  const specialization = String(options?.specialization ?? "").trim();

  if (country && major) {
    return [
      slugifyRecommendationPart(country),
      slugifyRecommendationPart(major),
      slugifyRecommendationPart(degree),
      specialization ? slugifyRecommendationPart(specialization) : "",
    ]
      .filter(Boolean)
      .join("-");
  }

  return [
    slugifyRecommendationPart(country || "unknown"),
    "baseline",
    slugifyRecommendationPart(degree),
  ].join("-");
}

function buildAdmissionsSyncHistoryLabel(options?: AdmissionsSyncOptions) {
  const country = String(options?.country ?? "").trim();
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const major = String(options?.major ?? "").trim();
  const specialization = String(options?.specialization ?? "").trim();
  const segments = [country, major || specialization || "定向同步", degree].filter(Boolean);
  return segments.join(" · ");
}

function normalizeWarmupState(
  input: Partial<StudyAbroadAdmissionsWarmupState> | null | undefined
) {
  return {
    updatedAt: String(input?.updatedAt ?? "").trim(),
    lastRecommendationRuns:
      input?.lastRecommendationRuns && typeof input.lastRecommendationRuns === "object"
        ? Object.fromEntries(
            Object.entries(input.lastRecommendationRuns).map(([key, value]) => [
              String(key).trim(),
              String(value ?? "").trim(),
            ])
          )
        : {},
    lastCountryRuns:
      input?.lastCountryRuns && typeof input.lastCountryRuns === "object"
        ? Object.fromEntries(
            Object.entries(input.lastCountryRuns).map(([key, value]) => [
              String(key).trim(),
              String(value ?? "").trim(),
            ])
          )
        : {},
    history: Array.isArray(input?.history)
      ? input.history
          .map((item) => ({
            runAt: String(item?.runAt ?? "").trim(),
            mode:
              item?.mode === "preset" ||
              item?.mode === "smart" ||
              item?.mode === "sprint" ||
              item?.mode === "direct"
                ? item.mode
                : "smart",
            recommendationId: String(item?.recommendationId ?? "").trim(),
            country: String(item?.country ?? "").trim(),
            label: String(item?.label ?? "").trim(),
            syncedCount: Math.max(0, Number(item?.syncedCount) || 0),
            okCount: Math.max(0, Number(item?.okCount) || 0),
            partialCount: Math.max(0, Number(item?.partialCount) || 0),
            unavailableCount: Math.max(0, Number(item?.unavailableCount) || 0),
          }))
          .filter((item) => item.runAt && item.recommendationId)
          .slice(0, 30)
      : [],
  } satisfies StudyAbroadAdmissionsWarmupState;
}

function normalizeCampaignState(
  input: Partial<StudyAbroadAdmissionsCampaignState> | null | undefined
) {
  return {
    updatedAt: String(input?.updatedAt ?? "").trim(),
    runs: Array.isArray(input?.runs)
      ? input.runs
          .map((item) => ({
            runAt: String(item?.runAt ?? "").trim(),
            mode: item?.mode === "roadmap" ? "roadmap" : "sprint",
            degree: String(item?.degree ?? "硕士").trim() || "硕士",
            rounds: Math.max(1, Number(item?.rounds) || 1),
            itemCount: Math.max(0, Number(item?.itemCount) || 0),
            countries: Array.isArray(item?.countries)
              ? item.countries.map((country) => String(country ?? "").trim()).filter(Boolean)
              : [],
            syncedCount: Math.max(0, Number(item?.syncedCount) || 0),
            okCount: Math.max(0, Number(item?.okCount) || 0),
            partialCount: Math.max(0, Number(item?.partialCount) || 0),
            unavailableCount: Math.max(0, Number(item?.unavailableCount) || 0),
            structuredDelta: Math.max(0, Number(item?.structuredDelta) || 0),
            completeDelta: Math.max(0, Number(item?.completeDelta) || 0),
            countryBreakdown: Array.isArray(item?.countryBreakdown)
              ? item.countryBreakdown
                  .map((entry) => ({
                    country: String(entry?.country ?? "").trim(),
                    structuredDelta: Math.max(
                      0,
                      Number(entry?.structuredDelta) || 0
                    ),
                    completeDelta: Math.max(0, Number(entry?.completeDelta) || 0),
                  }))
                  .filter((entry) => entry.country)
              : [],
            focusBreakdown: Array.isArray(item?.focusBreakdown)
              ? item.focusBreakdown
                  .map((entry) => ({
                    id: String(entry?.id ?? "").trim(),
                    label: String(entry?.label ?? "").trim(),
                    country: String(entry?.country ?? "").trim(),
                    major: String(entry?.major ?? "").trim(),
                    specialization: String(entry?.specialization ?? "").trim(),
                    syncedCount: Math.max(0, Number(entry?.syncedCount) || 0),
                    okCount: Math.max(0, Number(entry?.okCount) || 0),
                    partialCount: Math.max(0, Number(entry?.partialCount) || 0),
                    unavailableCount: Math.max(0, Number(entry?.unavailableCount) || 0),
                    structuredDelta: Math.max(0, Number(entry?.structuredDelta) || 0),
                    completeDelta: Math.max(0, Number(entry?.completeDelta) || 0),
                  }))
                  .filter((entry) => entry.id && entry.country)
              : [],
          }))
          .filter((item) => item.runAt)
          .slice(0, 40)
      : [],
  } satisfies StudyAbroadAdmissionsCampaignState;
}

function normalizeStrategy(
  input: Partial<StudyAbroadAdmissionsStrategy> | null | undefined
) {
  return {
    focusCooldownHours: Math.max(
      1,
      Math.min(168, Number(input?.focusCooldownHours) || DEFAULT_STRATEGY.focusCooldownHours)
    ),
    countryCooldownHours: Math.max(
      1,
      Math.min(168, Number(input?.countryCooldownHours) || DEFAULT_STRATEGY.countryCooldownHours)
    ),
    smartRecommendationCooldownHours: Math.max(
      1,
      Math.min(
        336,
        Number(input?.smartRecommendationCooldownHours) ||
          DEFAULT_STRATEGY.smartRecommendationCooldownHours
      )
    ),
  } satisfies StudyAbroadAdmissionsStrategy;
}

export async function readStudyAbroadAdmissionsWarmupState() {
  try {
    const raw = await readFile(dataFilePath(WARMUP_STATE_FILE), "utf8");
    return normalizeWarmupState(JSON.parse(raw));
  } catch {
    return DEFAULT_WARMUP_STATE;
  }
}

export async function readStudyAbroadAdmissionsCampaignState() {
  try {
    const raw = await readFile(dataFilePath(CAMPAIGN_STATE_FILE), "utf8");
    return normalizeCampaignState(JSON.parse(raw));
  } catch {
    return DEFAULT_CAMPAIGN_STATE;
  }
}

export async function readStudyAbroadAdmissionsStrategy() {
  try {
    const raw = await readFile(dataFilePath(STRATEGY_FILE), "utf8");
    return normalizeStrategy(JSON.parse(raw));
  } catch {
    return DEFAULT_STRATEGY;
  }
}

async function writeStudyAbroadAdmissionsWarmupState(
  state: StudyAbroadAdmissionsWarmupState
) {
  await mkdir(dirname(dataFilePath(WARMUP_STATE_FILE)), { recursive: true });
  await writeFile(
    dataFilePath(WARMUP_STATE_FILE),
    JSON.stringify(normalizeWarmupState(state), null, 2),
    "utf8"
  );
}

async function writeStudyAbroadAdmissionsCampaignState(
  state: StudyAbroadAdmissionsCampaignState
) {
  await mkdir(dirname(dataFilePath(CAMPAIGN_STATE_FILE)), { recursive: true });
  await writeFile(
    dataFilePath(CAMPAIGN_STATE_FILE),
    JSON.stringify(normalizeCampaignState(state), null, 2),
    "utf8"
  );
}

async function writeStudyAbroadAdmissionsStrategy(state: StudyAbroadAdmissionsStrategy) {
  await mkdir(dirname(dataFilePath(STRATEGY_FILE)), { recursive: true });
  await writeFile(
    dataFilePath(STRATEGY_FILE),
    JSON.stringify(normalizeStrategy(state), null, 2),
    "utf8"
  );
}

export async function updateStudyAbroadAdmissionsStrategy(
  input: Partial<StudyAbroadAdmissionsStrategy>
) {
  const current = await readStudyAbroadAdmissionsStrategy();
  const next = normalizeStrategy({
    ...current,
    ...input,
  });
  await writeStudyAbroadAdmissionsStrategy(next);
  return {
    ok: true,
    strategy: next,
    message: `已更新补齐冷却策略：方向冷却 ${next.focusCooldownHours} 小时，国家冷却 ${next.countryCooldownHours} 小时，智能推荐冷却 ${next.smartRecommendationCooldownHours} 小时。`,
  };
}

export function getStudyAbroadAdmissionsStrategyPresets() {
  return STRATEGY_PRESETS.map((preset) => ({
    ...preset,
    strategy: { ...preset.strategy },
  }));
}

export function getStudyAbroadAdmissionsStrategyPresetId(
  strategy: StudyAbroadAdmissionsStrategy
) {
  const normalized = normalizeStrategy(strategy);
  return (
    STRATEGY_PRESETS.find((preset) => {
      const candidate = normalizeStrategy(preset.strategy);
      return (
        candidate.focusCooldownHours === normalized.focusCooldownHours &&
        candidate.countryCooldownHours === normalized.countryCooldownHours &&
        candidate.smartRecommendationCooldownHours ===
          normalized.smartRecommendationCooldownHours
      );
    })?.id ?? ""
  );
}

function expandAliases(value: string, aliasGroups: Record<string, string[]>) {
  const normalizedValue = normalizeLookupText(value);
  if (!normalizedValue) return [];

  const expanded = new Set<string>([normalizedValue]);

  Object.entries(aliasGroups).forEach(([label, aliases]) => {
    const normalizedLabel = normalizeLookupText(label);
    const matched =
      normalizedValue.includes(normalizedLabel) ||
      aliases.some((alias) => normalizedValue.includes(normalizeLookupText(alias)));

    if (!matched) return;

    expanded.add(normalizedLabel);
    aliases.forEach((alias) => expanded.add(normalizeLookupText(alias)));
  });

  return Array.from(expanded).filter(Boolean);
}

function buildProgramSearchText(program: StudyAbroadCatalogProgram) {
  return normalizeLookupText(
    [
      program.schoolName,
      program.schoolNameZh,
      program.programName,
      program.discipline,
      program.summary,
      ...(program.keywords ?? []),
      ...(program.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function matchesDirection(
  program: StudyAbroadCatalogProgram,
  major: string,
  specialization: string
) {
  if (!major && !specialization) return true;

  const searchText = buildProgramSearchText(program);
  if (!searchText) return false;

  const majorTerms = [
    ...expandAliases(major, MAJOR_QUERY_ALIASES),
    ...expandAliases(major, MAJOR_FAMILIES),
  ];
  const specializationTerms = expandAliases(specialization, SPECIALIZATION_QUERY_ALIASES);

  if (majorTerms.length && !majorTerms.some((term) => searchText.includes(term))) {
    return false;
  }

  if (
    specializationTerms.length &&
    !specializationTerms.some((term) => searchText.includes(term))
  ) {
    return false;
  }

  return true;
}

function getAdmissionsCoverageFlags(program: StudyAbroadCatalogProgram) {
  const snapshot = program.admissionsSnapshot;
  const synced = Boolean(snapshot?.extractedAt);
  const structured = Boolean(
    snapshot &&
      (
        snapshot.gpaMin ||
        snapshot.ieltsMin ||
        snapshot.toeflMin ||
        snapshot.duolingoMin ||
        snapshot.pteMin ||
        snapshot.greStatus !== "unknown" ||
        snapshot.gmatStatus !== "unknown" ||
        snapshot.workExperienceYears
      )
  );
  const complete = snapshot?.extractionStatus === "ok";

  return {
    synced,
    structured,
    complete,
    missing: !synced,
  };
}

function summarizeAdmissionsCoverage(
  programs: StudyAbroadCatalogProgram[],
  options?: {
    countries?: string[];
    major?: string;
    specialization?: string;
  }
) {
  const countryFilterSet =
    Array.isArray(options?.countries) && options?.countries.length
      ? new Set(options.countries.map((item) => String(item ?? "").trim()).filter(Boolean))
      : null;
  const majorFilter = String(options?.major ?? "").trim();
  const specializationFilter = String(options?.specialization ?? "").trim();
  const specializationAliases = specializationFilter
    ? [
        specializationFilter,
        ...(SPECIALIZATION_QUERY_ALIASES[specializationFilter] ?? []),
      ]
    : [];
  const filteredPrograms = programs
    .filter((program) => (countryFilterSet ? countryFilterSet.has(program.country) : true))
    .filter((program) => (majorFilter ? String(program.discipline ?? "").trim() === majorFilter : true))
    .filter((program) => {
      if (!specializationAliases.length) return true;
      const searchText = [
        program.programName,
        program.summary,
        program.discipline,
        ...(program.keywords ?? []),
        ...(program.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ");
      return specializationAliases.some((alias) => matchesSearchToken(searchText, alias));
    });

  const totalPrograms = filteredPrograms.length;
  let syncedPrograms = 0;
  let structuredPrograms = 0;
  let completePrograms = 0;

  filteredPrograms.forEach((program) => {
    const coverage = getAdmissionsCoverageFlags(program);
    if (coverage.synced) syncedPrograms += 1;
    if (coverage.structured) structuredPrograms += 1;
    if (coverage.complete) completePrograms += 1;
  });

  return {
    totalPrograms,
    syncedPrograms,
    structuredPrograms,
    completePrograms,
    syncedCoveragePercent: toCoveragePercent(syncedPrograms, totalPrograms),
    structuredCoveragePercent: toCoveragePercent(structuredPrograms, totalPrograms),
    completeCoveragePercent: toCoveragePercent(completePrograms, totalPrograms),
  } satisfies StudyAbroadAdmissionsCoverageSnapshot;
}

function getCountryTarget(country: string): StudyAbroadAdmissionsCountryTarget {
  const normalizedCountry = String(country ?? "").trim();
  const matched = STUDY_ABROAD_COUNTRY_TARGETS.find(
    (item) => item.country === normalizedCountry
  );

  if (matched) {
    return { ...matched };
  }

  return {
    country: normalizedCountry,
    ...DEFAULT_COUNTRY_TARGET,
  };
}

function buildStudyAbroadAdmissionsCountryTargetStatusesFromPrograms(
  programs: StudyAbroadCatalogProgram[]
) {
  const countryMap = new Map<string, StudyAbroadAdmissionsCountryTargetStatus>();

  programs.forEach((program) => {
    const country = String(program.country ?? "").trim();
    if (!country) return;

    const target = getCountryTarget(country);
    const coverage = getAdmissionsCoverageFlags(program);
    const current = countryMap.get(country) ?? {
      ...target,
      totalPrograms: 0,
      syncedPrograms: 0,
      structuredPrograms: 0,
      completePrograms: 0,
      missingPrograms: 0,
      syncedCoveragePercent: 0,
      structuredCoveragePercent: 0,
      completeCoveragePercent: 0,
      targetGapPercent: 0,
      targetProgramGap: 0,
      status: "behind" as const,
    };

    current.totalPrograms += 1;
    if (coverage.synced) current.syncedPrograms += 1;
    if (coverage.structured) current.structuredPrograms += 1;
    if (coverage.complete) current.completePrograms += 1;
    if (coverage.missing) current.missingPrograms += 1;

    countryMap.set(country, current);
  });

  return new Map(
    Array.from(countryMap.entries()).map(([country, item]) => {
      const structuredCoveragePercent = toCoveragePercent(
        item.structuredPrograms,
        item.totalPrograms
      );
      const syncedCoveragePercent = toCoveragePercent(
        item.syncedPrograms,
        item.totalPrograms
      );
      const completeCoveragePercent = toCoveragePercent(
        item.completePrograms,
        item.totalPrograms
      );
      const targetProgramCount = Math.ceil(
        (item.totalPrograms * item.targetStructuredCoveragePercent) / 100
      );
      const targetProgramGap = Math.max(0, targetProgramCount - item.structuredPrograms);
      const targetGapPercent = Math.max(
        0,
        item.targetStructuredCoveragePercent - structuredCoveragePercent
      );
      const status =
        targetGapPercent <= 0
          ? "reached"
          : item.structuredPrograms > 0
            ? "progressing"
            : "behind";

      return [
        country,
        {
          ...item,
          syncedCoveragePercent,
          structuredCoveragePercent,
          completeCoveragePercent,
          targetGapPercent,
          targetProgramGap,
          status,
        } satisfies StudyAbroadAdmissionsCountryTargetStatus,
      ];
    })
  );
}

export function buildStudyAbroadAdmissionsCountryTargetStatuses(
  programs: StudyAbroadCatalogProgram[],
  options?: {
    degree?: string;
    countries?: string[];
    limit?: number;
  }
) {
  const degreeFilter = String(options?.degree ?? "").trim();
  const countryFilterSet =
    Array.isArray(options?.countries) && options?.countries.length
      ? new Set(options.countries.map((item) => String(item ?? "").trim()).filter(Boolean))
      : null;
  const filteredPrograms = programs
    .filter((program) => (degreeFilter ? program.degree === degreeFilter : true))
    .filter((program) => (countryFilterSet ? countryFilterSet.has(program.country) : true));

  const statusMap = buildStudyAbroadAdmissionsCountryTargetStatusesFromPrograms(filteredPrograms);
  const statuses = Array.from(statusMap.values()).sort((left, right) => {
    if (left.targetGapPercent !== right.targetGapPercent) {
      return right.targetGapPercent - left.targetGapPercent;
    }
    if (left.strategicPriority !== right.strategicPriority) {
      return right.strategicPriority - left.strategicPriority;
    }
    if (left.targetProgramGap !== right.targetProgramGap) {
      return right.targetProgramGap - left.targetProgramGap;
    }
    if (left.totalPrograms !== right.totalPrograms) {
      return right.totalPrograms - left.totalPrograms;
    }
    return left.country.localeCompare(right.country, "zh-CN");
  });

  const limit = Math.max(1, Math.min(Number(options?.limit) || statuses.length || 1, 20));
  return statuses.slice(0, limit);
}

export async function readStudyAbroadAdmissionsCountryTargetStatuses(options?: {
  degree?: string;
  countries?: string[];
  limit?: number;
}) {
  const programs = await readStudyAbroadCatalogPrograms();
  return buildStudyAbroadAdmissionsCountryTargetStatuses(programs, options);
}

function buildStudyAbroadAdmissionsCountryTargetPlans(
  programs: StudyAbroadCatalogProgram[],
  options?: {
    degree?: string;
    countries?: string[];
    limit?: number;
    focusLimit?: number;
    state?: StudyAbroadAdmissionsWarmupState;
    strategy?: StudyAbroadAdmissionsStrategy;
  }
) {
  const statuses = buildStudyAbroadAdmissionsCountryTargetStatuses(programs, options);
  const degreeFilter = String(options?.degree ?? "").trim() || "硕士";
  const countryFilterSet =
    Array.isArray(options?.countries) && options?.countries.length
      ? new Set(options.countries.map((item) => String(item ?? "").trim()).filter(Boolean))
      : null;
  const focusLimit = Math.max(1, Math.min(Number(options?.focusLimit) || 3, 5));
  const state = normalizeWarmupState(options?.state ?? DEFAULT_WARMUP_STATE);
  const strategy = normalizeStrategy(options?.strategy ?? DEFAULT_STRATEGY);
  const filteredPrograms = programs
    .filter((program) => (degreeFilter ? program.degree === degreeFilter : true))
    .filter((program) => (countryFilterSet ? countryFilterSet.has(program.country) : true))
    .filter((program) => Boolean(program.country && program.discipline));

  return statuses.map((status) => {
    const focusMap = new Map<string, StudyAbroadAdmissionsCountryTargetFocusRecommendation>();

    filteredPrograms
      .filter((program) => program.country === status.country)
      .forEach((program) => {
        const major = String(program.discipline ?? "").trim();
        if (!major) return;

        const key = `${status.country}__${degreeFilter}__${major}`;
        const current = focusMap.get(key) ?? {
          id: `${slugifyRecommendationPart(status.country)}-${slugifyRecommendationPart(major)}-${slugifyRecommendationPart(degreeFilter)}`,
          label: `${status.country} · ${major} · ${degreeFilter}`,
          description: `优先补 ${status.country}${major}${degreeFilter}项目，让这个国家先有一批能稳定对比的门槛结果。`,
          country: status.country,
          degree: degreeFilter,
          major,
          specialization: "",
          totalPrograms: 0,
          syncedPrograms: 0,
          structuredPrograms: 0,
          completePrograms: 0,
          missingPrograms: 0,
          structuredCoveragePercent: 0,
          gapScore: 0,
          recommendationScore: 0,
          missingGapScore: 0,
          structuredGapScore: 0,
          completeGapScore: 0,
          targetGapScore: 0,
          priorityScore: 0,
          volumeScore: 0,
          recencyBoostScore: 0,
          recencyPenaltyScore: 0,
          maxPrograms: 4,
          lastRecommendationRunAt: "",
          lastRecommendationRunDays: Number.POSITIVE_INFINITY,
          lastRecommendationRunLabel: "未补过",
          recentlyRun: false,
          coolingDown: false,
          cooldownHours: strategy.focusCooldownHours,
          cooldownRemainingHours: 0,
          coolingDownUntil: "",
        };

        const coverage = getAdmissionsCoverageFlags(program);
        current.totalPrograms += 1;
        if (coverage.synced) current.syncedPrograms += 1;
        if (coverage.structured) current.structuredPrograms += 1;
        if (coverage.complete) current.completePrograms += 1;
        if (coverage.missing) current.missingPrograms += 1;

        focusMap.set(key, current);
      });

    const focusRecommendations = Array.from(focusMap.values())
      .map((item) => {
        const structuredCoveragePercent = toCoveragePercent(
          item.structuredPrograms,
          item.totalPrograms
        );
        const structuredGap = item.totalPrograms - item.structuredPrograms;
        const completeGap = item.totalPrograms - item.completePrograms;
        const missingGapScore = item.missingPrograms * 6;
        const structuredGapScore = structuredGap * 4;
        const completeGapScore = completeGap * 2;
        const priorityScore = status.strategicPriority * 18;
        const targetGapScore = Math.min(status.targetGapPercent, 40) * 10;
        const volumeScore = Math.min(item.totalPrograms, 12);
        const gapScore =
          missingGapScore +
          structuredGapScore +
          completeGapScore +
          priorityScore +
          targetGapScore +
          volumeScore;
        const lastRecommendationRunAt = state.lastRecommendationRuns[item.id] || "";
        const lastRecommendationRunDays = daysSince(lastRecommendationRunAt);
        const lastRecommendationRunHours = hoursSince(lastRecommendationRunAt);
        const neverRun = !Number.isFinite(lastRecommendationRunDays);
        const coolingDown = !neverRun && lastRecommendationRunHours < strategy.focusCooldownHours;
        const cooldownRemainingHours = coolingDown
          ? Math.max(0, Math.ceil(strategy.focusCooldownHours - lastRecommendationRunHours))
          : 0;
        const coolingDownUntil =
          coolingDown && lastRecommendationRunAt
            ? addHours(lastRecommendationRunAt, strategy.focusCooldownHours).toISOString()
            : "";
        const recencyPenalty = neverRun
          ? 0
          : coolingDown
            ? 420
            : lastRecommendationRunDays < 3
              ? 160
              : lastRecommendationRunDays < 7
                ? 60
                : 0;
        const recencyBoostScore = Math.round(
          neverRun ? 140 : Math.min(lastRecommendationRunDays, 21) * 8
        );
        const recencyPenaltyScore = recencyPenalty;
        const recommendationScore = Math.round(
          gapScore + recencyBoostScore - recencyPenaltyScore
        );
        const maxPrograms = Math.min(10, Math.max(4, Math.ceil(item.missingPrograms / 2)));

        return {
          ...item,
          structuredCoveragePercent,
          gapScore,
          recommendationScore,
          missingGapScore,
          structuredGapScore,
          completeGapScore,
          targetGapScore,
          priorityScore,
          volumeScore,
          recencyBoostScore,
          recencyPenaltyScore,
          maxPrograms,
          lastRecommendationRunAt,
          lastRecommendationRunDays,
          lastRecommendationRunLabel: lastRecommendationRunAt
            ? formatLocalDateTime(new Date(lastRecommendationRunAt))
            : "未补过",
          recentlyRun: !neverRun && lastRecommendationRunDays < 3,
          coolingDown,
          cooldownHours: strategy.focusCooldownHours,
          cooldownRemainingHours,
          coolingDownUntil,
        };
      })
      .filter((item) => item.totalPrograms >= (status.strategicPriority >= 4 ? 1 : 2))
      .filter((item) => item.missingPrograms > 0 || item.structuredPrograms < item.totalPrograms)
      .sort((left, right) => {
        if (left.recommendationScore !== right.recommendationScore) {
          return right.recommendationScore - left.recommendationScore;
        }
        if (left.gapScore !== right.gapScore) {
          return right.gapScore - left.gapScore;
        }
        if (left.missingPrograms !== right.missingPrograms) {
          return right.missingPrograms - left.missingPrograms;
        }
        if (left.totalPrograms !== right.totalPrograms) {
          return right.totalPrograms - left.totalPrograms;
        }
        return left.label.localeCompare(right.label, "zh-CN");
      })
      .slice(0, focusLimit);

    return {
      ...status,
      focusRecommendations,
    } satisfies StudyAbroadAdmissionsCountryTargetPlan;
  });
}

export async function readStudyAbroadAdmissionsCountryTargetPlans(options?: {
  degree?: string;
  countries?: string[];
  limit?: number;
  focusLimit?: number;
}) {
  const [programs, state, strategy] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);
  return buildStudyAbroadAdmissionsCountryTargetPlans(programs, {
    ...options,
    state,
    strategy,
  });
}

function computeCountryTargetPlanQueueScore(
  plan: StudyAbroadAdmissionsCountryTargetPlan,
  state: StudyAbroadAdmissionsWarmupState,
  strategy: StudyAbroadAdmissionsStrategy
) {
  const lastCountryRunAt = state.lastCountryRuns[plan.country] || "";
  const lastCountryRunDays = daysSince(lastCountryRunAt);
  const lastCountryRunHours = hoursSince(lastCountryRunAt);
  const neverRunCountry = !Number.isFinite(lastCountryRunDays);
  const recencyPenalty = neverRunCountry
    ? 0
    : lastCountryRunHours < strategy.countryCooldownHours
      ? 9600 - lastCountryRunHours * 120
      : lastCountryRunDays < 7
      ? 9000 - lastCountryRunDays * 1200
      : Math.max(0, 21 - lastCountryRunDays) * 120;
  const recencyBoost = neverRunCountry ? 240 : Math.min(lastCountryRunDays, 30) * 10;
  const focusBoost = Math.min(plan.focusRecommendations.length, 3) * 180;
  const executionPenalty = plan.focusRecommendations.length ? 0 : 320;

  return {
    queueScore: Math.round(
      plan.targetGapPercent * 260 +
      plan.strategicPriority * 300 +
      Math.min(plan.targetProgramGap, 18) * 24 +
      focusBoost +
      recencyBoost -
      recencyPenalty -
      executionPenalty
    ),
    lastCountryRunAt,
    lastCountryRunDays,
  };
}

export function buildStudyAbroadAdmissionsCountryTargetExecutionQueue(
  plans: StudyAbroadAdmissionsCountryTargetPlan[],
  state: StudyAbroadAdmissionsWarmupState,
  options?: {
    limit?: number;
    strategy?: StudyAbroadAdmissionsStrategy;
  }
) {
  const limit = Math.max(1, Math.min(Number(options?.limit) || 6, 12));
  const strategy = normalizeStrategy(options?.strategy ?? DEFAULT_STRATEGY);

  return plans
    .map((plan) => {
      const scored = computeCountryTargetPlanQueueScore(plan, state, strategy);
      return {
        ...plan,
        ...scored,
      } satisfies StudyAbroadAdmissionsCountryTargetQueueItem;
    })
    .filter((item) => item.targetGapPercent > 0)
    .sort((left, right) => {
      if (left.queueScore !== right.queueScore) {
        return right.queueScore - left.queueScore;
      }
      if (left.targetGapPercent !== right.targetGapPercent) {
        return right.targetGapPercent - left.targetGapPercent;
      }
      if (left.strategicPriority !== right.strategicPriority) {
        return right.strategicPriority - left.strategicPriority;
      }
      if (left.targetProgramGap !== right.targetProgramGap) {
        return right.targetProgramGap - left.targetProgramGap;
      }
      return left.country.localeCompare(right.country, "zh-CN");
    })
    .slice(0, limit);
}

export async function readStudyAbroadAdmissionsCountryTargetExecutionQueue(options?: {
  degree?: string;
  countries?: string[];
  limit?: number;
  focusLimit?: number;
}) {
  const [programs, state, strategy] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);
  const plans = buildStudyAbroadAdmissionsCountryTargetPlans(programs, {
    ...options,
    state,
    strategy,
  });
  return buildStudyAbroadAdmissionsCountryTargetExecutionQueue(plans, state, {
    ...options,
    strategy,
  });
}

function toCoverageSprintItemKey(item: {
  country: string;
  degree: string;
  major: string;
  specialization: string;
}) {
  return [
    String(item.country ?? "").trim(),
    String(item.degree ?? "").trim(),
    String(item.major ?? "").trim(),
    String(item.specialization ?? "").trim(),
  ].join("__");
}

export function buildStudyAbroadAdmissionsCoverageSprintPlan(
  programs: StudyAbroadCatalogProgram[],
  state: StudyAbroadAdmissionsWarmupState,
  options?: {
    degree?: string;
    maxCountries?: number;
    maxFocusPerCountry?: number;
    maxRecommendations?: number;
    strategy?: StudyAbroadAdmissionsStrategy;
  }
) {
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const maxCountries = Math.max(1, Math.min(Number(options?.maxCountries) || 2, 4));
  const maxFocusPerCountry = Math.max(
    1,
    Math.min(Number(options?.maxFocusPerCountry) || 2, 3)
  );
  const maxRecommendations = Math.max(
    1,
    Math.min(Number(options?.maxRecommendations) || 3, 6)
  );
  const strategy = normalizeStrategy(options?.strategy ?? DEFAULT_STRATEGY);

  const countryPlans = buildStudyAbroadAdmissionsCountryTargetPlans(programs, {
    degree,
    limit: Math.max(maxCountries * 3, 8),
    focusLimit: maxFocusPerCountry,
    state,
    strategy,
  });
  const countryQueue = buildStudyAbroadAdmissionsCountryTargetExecutionQueue(
    countryPlans,
    state,
    { limit: maxCountries, strategy }
  );
  const smartRecommendations = buildStudyAbroadAdmissionsWarmupRecommendations(programs, {
    degree,
    limit: Math.max(maxRecommendations * 3, 8),
    state,
    strategy,
  });

  const items: StudyAbroadAdmissionsCoverageSprintItem[] = [];
  const seenKeys = new Set<string>();
  const seenCountries = new Map<string, number>();
  const totalLimit = Math.max(maxCountries * maxFocusPerCountry + maxRecommendations, 4);

  const tryPush = (item: StudyAbroadAdmissionsCoverageSprintItem) => {
    const key = toCoverageSprintItemKey(item);
    if (seenKeys.has(key)) return false;

    seenKeys.add(key);
    seenCountries.set(item.country, (seenCountries.get(item.country) ?? 0) + 1);
    items.push(item);
    return true;
  };

  countryQueue.forEach((plan) => {
    const focusList = plan.focusRecommendations.length
      ? plan.focusRecommendations.slice(0, maxFocusPerCountry)
      : [
          {
            id: `${slugifyRecommendationPart(plan.country)}-baseline-${slugifyRecommendationPart(degree)}`,
            label: `${plan.country} · ${degree}基础覆盖`,
            description: plan.note,
            country: plan.country,
            degree,
            major: "",
            specialization: "",
            totalPrograms: plan.totalPrograms,
            syncedPrograms: plan.syncedPrograms,
            structuredPrograms: plan.structuredPrograms,
            completePrograms: plan.completePrograms,
            missingPrograms: plan.missingPrograms,
            structuredCoveragePercent: plan.structuredCoveragePercent,
            gapScore:
              plan.targetProgramGap * 20 +
              plan.strategicPriority * 18 +
              Math.min(plan.totalPrograms, 12),
            recommendationScore:
              plan.targetProgramGap * 20 +
              plan.strategicPriority * 18 +
              Math.min(plan.totalPrograms, 12),
            missingGapScore: 0,
            structuredGapScore: 0,
            completeGapScore: 0,
            targetGapScore: plan.targetProgramGap * 20,
            priorityScore: plan.strategicPriority * 18,
            volumeScore: Math.min(plan.totalPrograms, 12),
            recencyBoostScore: 0,
            recencyPenaltyScore: 0,
            maxPrograms: Math.min(10, Math.max(4, plan.targetProgramGap || 4)),
            lastRecommendationRunAt: "",
            lastRecommendationRunDays: Number.POSITIVE_INFINITY,
            lastRecommendationRunLabel: "未补过",
            recentlyRun: false,
            coolingDown: false,
            cooldownHours: strategy.focusCooldownHours,
            cooldownRemainingHours: 0,
            coolingDownUntil: "",
          } satisfies StudyAbroadAdmissionsCountryTargetFocusRecommendation,
        ];

    focusList.forEach((focus) => {
      tryPush({
        id: focus.id,
        source: "country-target",
        label: focus.label,
        description: focus.description,
        reason: `${plan.country} 当前结构化覆盖 ${plan.structuredCoveragePercent}%，离目标线还差 ${plan.targetGapPercent}%。`,
        country: focus.country,
        degree: focus.degree,
        major: focus.major,
        specialization: focus.specialization,
        maxPrograms: focus.maxPrograms,
      });
    });
  });

  for (const recommendation of smartRecommendations) {
    if (items.length >= totalLimit) break;

    const currentCountryCount = seenCountries.get(recommendation.country) ?? 0;
    if (currentCountryCount >= 3) {
      continue;
    }

    tryPush({
      id: recommendation.id,
      source: "smart",
      label: recommendation.label,
      description: recommendation.description,
      reason: `智能分 ${recommendation.smartScore}，当前还有 ${recommendation.missingPrograms} 个项目待补抓。`,
      country: recommendation.country,
      degree: recommendation.degree,
      major: recommendation.major,
      specialization: recommendation.specialization,
      maxPrograms: recommendation.maxPrograms,
    });
  }

  const countries = Array.from(new Set(items.map((item) => item.country))).filter(Boolean);
  const estimatedPrograms = items.reduce(
    (total, item) => total + Math.max(1, Number(item.maxPrograms) || 0),
    0
  );

  return {
    degree,
    items,
    estimatedPrograms,
    countries,
    summary:
      items.length
        ? `本轮建议先跑 ${items.length} 组补齐任务，覆盖 ${countries.length} 个国家 / 地区，预计尝试同步 ${estimatedPrograms} 个项目。`
        : "当前没有可执行的覆盖冲刺任务。",
  } satisfies StudyAbroadAdmissionsCoverageSprintPlan;
}

export async function readStudyAbroadAdmissionsCoverageSprintPlan(options?: {
  degree?: string;
  maxCountries?: number;
  maxFocusPerCountry?: number;
  maxRecommendations?: number;
}) {
  const [programs, state, strategy] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);

  return buildStudyAbroadAdmissionsCoverageSprintPlan(programs, state, {
    ...options,
    strategy,
  });
}

export function buildStudyAbroadAdmissionsCoverageGoalSummary(
  programs: StudyAbroadCatalogProgram[],
  options?: {
    degree?: string;
    countries?: string[];
  }
) {
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const countries =
    Array.isArray(options?.countries) && options.countries.length
      ? options.countries
      : STUDY_ABROAD_COUNTRY_TARGETS.map((item) => item.country);
  const statuses = buildStudyAbroadAdmissionsCountryTargetStatuses(programs, {
    degree,
    countries,
  });
  const totalPrograms = statuses.reduce((total, item) => total + item.totalPrograms, 0);
  const currentStructuredPrograms = statuses.reduce(
    (total, item) => total + item.structuredPrograms,
    0
  );
  const targetStructuredPrograms = statuses.reduce((total, item) => {
    return (
      total +
      Math.ceil((item.totalPrograms * item.targetStructuredCoveragePercent) / 100)
    );
  }, 0);
  const remainingStructuredPrograms = Math.max(
    0,
    targetStructuredPrograms - currentStructuredPrograms
  );

  return {
    degree,
    totalPrograms,
    keyCountries: statuses.length,
    currentStructuredPrograms,
    targetStructuredPrograms,
    remainingStructuredPrograms,
    currentCoveragePercent: toCoveragePercent(currentStructuredPrograms, totalPrograms),
    targetCoveragePercent: toCoveragePercent(targetStructuredPrograms, totalPrograms),
    countries: statuses,
  } satisfies StudyAbroadAdmissionsCoverageGoalSummary;
}

export async function readStudyAbroadAdmissionsCoverageGoalSummary(options?: {
  degree?: string;
  countries?: string[];
}) {
  const programs = await readStudyAbroadCatalogPrograms();
  return buildStudyAbroadAdmissionsCoverageGoalSummary(programs, options);
}

async function recordStudyAbroadAdmissionsCampaignRun(
  run: StudyAbroadAdmissionsCampaignRun
) {
  const current = await readStudyAbroadAdmissionsCampaignState();
  const nextState = normalizeCampaignState({
    updatedAt: run.runAt,
    runs: [run, ...current.runs].slice(0, 40),
  });
  await writeStudyAbroadAdmissionsCampaignState(nextState);
  return nextState;
}

export async function readStudyAbroadAdmissionsCampaignOutlook(options?: {
  degree?: string;
  countries?: string[];
}) {
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const [programs, campaignState] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsCampaignState(),
  ]);
  const goal = buildStudyAbroadAdmissionsCoverageGoalSummary(programs, options);
  const recentRuns = campaignState.runs
    .filter((item) => item.degree === degree)
    .slice(0, 8);
  const divisor = recentRuns.length || 1;
  const averageStructuredDelta = Math.round(
    recentRuns.reduce((total, item) => total + item.structuredDelta, 0) / divisor
  );
  const averageCompleteDelta = Math.round(
    recentRuns.reduce((total, item) => total + item.completeDelta, 0) / divisor
  );
  const averageSyncedCount = Math.round(
    recentRuns.reduce((total, item) => total + item.syncedCount, 0) / divisor
  );
  const estimatedRunsToTarget =
    goal.remainingStructuredPrograms > 0 && averageStructuredDelta > 0
      ? Math.ceil(goal.remainingStructuredPrograms / averageStructuredDelta)
      : null;
  const suggestedRhythm =
    estimatedRunsToTarget === null
      ? "accelerate"
      : estimatedRunsToTarget > 24
        ? "accelerate"
        : estimatedRunsToTarget > 8
          ? "steady"
          : "precision";
  const rhythmLabel =
    suggestedRhythm === "accelerate"
      ? "需要继续加速补齐，适合连续多轮推进。"
      : suggestedRhythm === "steady"
        ? "已经进入稳定推进区间，适合按周持续补齐。"
        : "已经接近目标线，适合转向更细的定向补抓。";

  return {
    degree,
    goal,
    recentRuns,
    averageStructuredDelta,
    averageCompleteDelta,
    averageSyncedCount,
    estimatedRunsToTarget,
    suggestedRhythm,
    summary:
      estimatedRunsToTarget === null
        ? `最近还没有足够的结构化增量样本，先多跑几轮把速度跑起来。${rhythmLabel}`
        : `按最近节奏，预计还需要约 ${estimatedRunsToTarget} 轮覆盖冲刺才能把重点国家推到目标线。${rhythmLabel}`,
  } satisfies StudyAbroadAdmissionsCampaignOutlook;
}

export async function readStudyAbroadAdmissionsCampaignTrend(options?: {
  degree?: string;
  days?: number;
}) {
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const dayCount = Math.min(14, Math.max(3, Number(options?.days) || 7));
  const campaignState = await readStudyAbroadAdmissionsCampaignState();
  const now = new Date();
  const buckets = new Map<
    string,
    {
      label: string;
      runCount: number;
      syncedCount: number;
      structuredDelta: number;
      completeDelta: number;
      countries: Set<string>;
    }
  >();

  for (let offset = dayCount - 1; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - offset);
    const dateKey = formatLocalDate(day);
    buckets.set(dateKey, {
      label: `${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`,
      runCount: 0,
      syncedCount: 0,
      structuredDelta: 0,
      completeDelta: 0,
      countries: new Set<string>(),
    });
  }

  campaignState.runs
    .filter((item) => item.degree === degree)
    .forEach((item) => {
      const runDate = new Date(item.runAt);
      const dateKey = formatLocalDate(runDate);
      const bucket = buckets.get(dateKey);
      if (!bucket) return;

      bucket.runCount += 1;
      bucket.syncedCount += item.syncedCount;
      bucket.structuredDelta += item.structuredDelta;
      bucket.completeDelta += item.completeDelta;
      item.countries.forEach((country) => bucket.countries.add(country));
    });

  const days = Array.from(buckets.entries()).map(([date, bucket]) => ({
    date,
    label: bucket.label,
    runCount: bucket.runCount,
    syncedCount: bucket.syncedCount,
    structuredDelta: bucket.structuredDelta,
    completeDelta: bucket.completeDelta,
    countries: Array.from(bucket.countries).sort(),
  }));

  const totals = days.reduce(
    (acc, day) => ({
      runCount: acc.runCount + day.runCount,
      syncedCount: acc.syncedCount + day.syncedCount,
      structuredDelta: acc.structuredDelta + day.structuredDelta,
      completeDelta: acc.completeDelta + day.completeDelta,
    }),
    {
      runCount: 0,
      syncedCount: 0,
      structuredDelta: 0,
      completeDelta: 0,
    }
  );

  return {
    degree,
    days,
    totals,
    hasActivity: totals.runCount > 0,
  } satisfies StudyAbroadAdmissionsCampaignTrend;
}

export async function readStudyAbroadAdmissionsCampaignCountryTrend(options?: {
  degree?: string;
  days?: number;
}) {
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const dayCount = Math.min(14, Math.max(3, Number(options?.days) || 7));
  const campaignState = await readStudyAbroadAdmissionsCampaignState();
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() - (dayCount - 1));
  const earliestTimestamp = earliest.getTime();
  const countryMap = new Map<
    string,
    {
      runCount: number;
      activeDates: Set<string>;
      structuredDelta: number;
      completeDelta: number;
      lastRunAt: string;
    }
  >();

  campaignState.runs
    .filter((item) => item.degree === degree)
    .forEach((item) => {
      const runAt = new Date(item.runAt);
      if (runAt.getTime() < earliestTimestamp) return;

      const runDate = formatLocalDate(runAt);
      const breakdown =
        item.countryBreakdown.length > 0
          ? item.countryBreakdown
          : item.countries.length === 1
            ? [
                {
                  country: item.countries[0],
                  structuredDelta: item.structuredDelta,
                  completeDelta: item.completeDelta,
                },
              ]
            : item.countries.map((country) => ({
                country,
                structuredDelta: 0,
                completeDelta: 0,
              }));

      breakdown.forEach((entry) => {
        const current = countryMap.get(entry.country) ?? {
          runCount: 0,
          activeDates: new Set<string>(),
          structuredDelta: 0,
          completeDelta: 0,
          lastRunAt: "",
        };

        current.runCount += 1;
        current.activeDates.add(runDate);
        current.structuredDelta += entry.structuredDelta;
        current.completeDelta += entry.completeDelta;
        if (!current.lastRunAt || toTimestamp(item.runAt) > toTimestamp(current.lastRunAt)) {
          current.lastRunAt = item.runAt;
        }

        countryMap.set(entry.country, current);
      });
    });

  const countries = Array.from(countryMap.entries())
    .map(([country, value]) => ({
      country,
      runCount: value.runCount,
      activeDays: value.activeDates.size,
      structuredDelta: value.structuredDelta,
      completeDelta: value.completeDelta,
      lastRunAt: value.lastRunAt,
      lastRunLabel: value.lastRunAt
        ? formatLocalDateTime(new Date(value.lastRunAt))
        : "待补",
    }))
    .sort((a, b) => {
      if (b.structuredDelta !== a.structuredDelta) {
        return b.structuredDelta - a.structuredDelta;
      }
      if (b.completeDelta !== a.completeDelta) {
        return b.completeDelta - a.completeDelta;
      }
      if (b.activeDays !== a.activeDays) {
        return b.activeDays - a.activeDays;
      }
      return b.runCount - a.runCount;
    });

  return {
    degree,
    days: dayCount,
    countries,
    hasActivity: countries.length > 0,
  } satisfies StudyAbroadAdmissionsCampaignCountryTrend;
}

export async function readStudyAbroadAdmissionsCampaignCountryFocusTrend(options?: {
  degree?: string;
  days?: number;
  countryLimit?: number;
  focusLimit?: number;
}) {
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const dayCount = Math.min(14, Math.max(3, Number(options?.days) || 7));
  const countryLimit = Math.max(1, Math.min(Number(options?.countryLimit) || 3, 6));
  const focusLimit = Math.max(1, Math.min(Number(options?.focusLimit) || 3, 5));
  const campaignState = await readStudyAbroadAdmissionsCampaignState();
  const earliest = new Date();
  earliest.setHours(0, 0, 0, 0);
  earliest.setDate(earliest.getDate() - (dayCount - 1));
  const earliestTimestamp = earliest.getTime();
  const countryMap = new Map<
    string,
    Map<string, StudyAbroadAdmissionsCampaignCountryFocusTrendFocus>
  >();

  campaignState.runs
    .filter((item) => item.degree === degree)
    .forEach((item) => {
      const runAt = new Date(item.runAt);
      if (runAt.getTime() < earliestTimestamp) return;

      item.focusBreakdown.forEach((focus) => {
        const countryFocusMap =
          countryMap.get(focus.country) ??
          new Map<string, StudyAbroadAdmissionsCampaignCountryFocusTrendFocus>();
        const current = countryFocusMap.get(focus.id) ?? {
          id: focus.id,
          label: focus.label,
          major: focus.major,
          specialization: focus.specialization,
          runCount: 0,
          syncedCount: 0,
          okCount: 0,
          structuredDelta: 0,
          completeDelta: 0,
        };

        current.runCount += 1;
        current.syncedCount += focus.syncedCount;
        current.okCount += focus.okCount;
        current.structuredDelta += focus.structuredDelta;
        current.completeDelta += focus.completeDelta;
        countryFocusMap.set(focus.id, current);
        countryMap.set(focus.country, countryFocusMap);
      });
    });

  const countries = Array.from(countryMap.entries())
    .map(([country, focusMap]) => ({
      country,
      focuses: Array.from(focusMap.values())
        .sort((left, right) => {
          if (right.structuredDelta !== left.structuredDelta) {
            return right.structuredDelta - left.structuredDelta;
          }
          if (right.completeDelta !== left.completeDelta) {
            return right.completeDelta - left.completeDelta;
          }
          if (right.syncedCount !== left.syncedCount) {
            return right.syncedCount - left.syncedCount;
          }
          return right.runCount - left.runCount;
        })
        .slice(0, focusLimit),
    }))
    .sort((left, right) => {
      const rightScore = right.focuses.reduce(
        (total, item) => total + item.structuredDelta * 2 + item.completeDelta,
        0
      );
      const leftScore = left.focuses.reduce(
        (total, item) => total + item.structuredDelta * 2 + item.completeDelta,
        0
      );
      return rightScore - leftScore;
    })
    .slice(0, countryLimit);

  return {
    degree,
    days: dayCount,
    countries,
    hasActivity: countries.length > 0,
  } satisfies StudyAbroadAdmissionsCampaignCountryFocusTrend;
}

export async function readStudyAbroadAdmissionsCountryRecentActivity(options?: {
  countries?: string[];
  limit?: number;
}) {
  const warmupState = await readStudyAbroadAdmissionsWarmupState();
  const countryFilterSet =
    Array.isArray(options?.countries) && options?.countries.length
      ? new Set(options.countries.map((item) => String(item ?? "").trim()).filter(Boolean))
      : null;
  const limit = Math.max(1, Math.min(Number(options?.limit) || 12, 24));
  const activityMap = new Map<string, StudyAbroadAdmissionsCountryRecentActivityItem>();

  warmupState.history.forEach((item) => {
    const country = String(item.country ?? "").trim();
    if (!country) return;
    if (countryFilterSet && !countryFilterSet.has(country)) return;

    const current = activityMap.get(country);
    if (current && toTimestamp(current.runAt) >= toTimestamp(item.runAt)) {
      if (current.runAt === item.runAt && !current.labels.includes(item.label)) {
        current.labels.push(item.label);
        current.syncedCount += item.syncedCount;
        current.okCount += item.okCount;
        current.partialCount += item.partialCount;
        current.unavailableCount += item.unavailableCount;
      }
      return;
    }

    activityMap.set(country, {
      country,
      runAt: item.runAt,
      runAtLabel: formatLocalDateTime(new Date(item.runAt)),
      mode: item.mode,
      label: item.label,
      labels: [item.label],
      syncedCount: item.syncedCount,
      okCount: item.okCount,
      partialCount: item.partialCount,
      unavailableCount: item.unavailableCount,
    });
  });

  return Array.from(activityMap.values())
    .sort((left, right) => toTimestamp(right.runAt) - toTimestamp(left.runAt))
    .slice(0, limit);
}

export async function readStudyAbroadAdmissionsCampaignCadence(options?: {
  degree?: string;
  countries?: string[];
}) {
  const outlook = await readStudyAbroadAdmissionsCampaignOutlook(options);

  if (outlook.suggestedRhythm === "accelerate") {
    return {
      degree: outlook.degree,
      rhythm: "accelerate",
      label: "加速推进",
      description: "当前离目标线还远，适合连续多轮拉动热门国家和高价值方向。",
      rounds: 3,
      maxCountries: 2,
      maxFocusPerCountry: 2,
      maxRecommendations: 3,
      suggestedRunsPerWeek: 5,
    } satisfies StudyAbroadAdmissionsCampaignCadence;
  }

  if (outlook.suggestedRhythm === "steady") {
    return {
      degree: outlook.degree,
      rhythm: "steady",
      label: "稳定补齐",
      description: "当前已经有一定推进速度，适合保持均衡节奏，持续往目标线收口。",
      rounds: 2,
      maxCountries: 2,
      maxFocusPerCountry: 2,
      maxRecommendations: 2,
      suggestedRunsPerWeek: 3,
    } satisfies StudyAbroadAdmissionsCampaignCadence;
  }

  return {
    degree: outlook.degree,
    rhythm: "precision",
    label: "精修收口",
    description: "当前已经接近目标线，适合缩小范围，定向补抓剩余薄弱方向。",
    rounds: 1,
    maxCountries: 1,
    maxFocusPerCountry: 1,
    maxRecommendations: 2,
    suggestedRunsPerWeek: 2,
  } satisfies StudyAbroadAdmissionsCampaignCadence;
}

function computeNextCampaignScheduleRun(
  weekdays: number[],
  hour: number,
  minute: number,
  now = new Date()
) {
  const current = new Date(now);
  current.setSeconds(0, 0);

  for (let offset = 0; offset < 14; offset += 1) {
    const candidate = new Date(current);
    candidate.setDate(current.getDate() + offset);
    candidate.setHours(hour, minute, 0, 0);

    if (!weekdays.includes(candidate.getDay())) {
      continue;
    }

    if (candidate.getTime() <= current.getTime()) {
      continue;
    }

    return candidate;
  }

  const fallback = new Date(current);
  fallback.setDate(current.getDate() + 1);
  fallback.setHours(hour, minute, 0, 0);
  return fallback;
}

export async function readStudyAbroadAdmissionsCampaignSchedule(options?: {
  degree?: string;
  countries?: string[];
}) {
  const cadence = await readStudyAbroadAdmissionsCampaignCadence(options);
  const scheduleMap =
    cadence.rhythm === "accelerate"
      ? {
          weekdays: [1, 2, 3, 4, 5],
          weekdayLabels: ["周一", "周二", "周三", "周四", "周五"],
          hour: 10,
          minute: 0,
          frequencyLabel: "工作日每天 10:00",
        }
      : cadence.rhythm === "steady"
        ? {
            weekdays: [1, 3, 5],
            weekdayLabels: ["周一", "周三", "周五"],
            hour: 10,
            minute: 0,
            frequencyLabel: "每周一 / 三 / 五 10:00",
          }
        : {
            weekdays: [2, 4],
            weekdayLabels: ["周二", "周四"],
            hour: 10,
            minute: 0,
            frequencyLabel: "每周二 / 四 10:00",
          };

  const nextRun = computeNextCampaignScheduleRun(
    scheduleMap.weekdays,
    scheduleMap.hour,
    scheduleMap.minute
  );

  return {
    degree: cadence.degree,
    cadence,
    weekdayLabels: scheduleMap.weekdayLabels,
    hour: scheduleMap.hour,
    minute: scheduleMap.minute,
    frequencyLabel: scheduleMap.frequencyLabel,
    nextRunAt: nextRun.toISOString(),
    nextRunLabel: formatLocalDateTime(nextRun),
    command: "npm run study-abroad:campaign -- --mode=cadence",
    suggestedAutomationName: "留学门槛自动补齐",
  } satisfies StudyAbroadAdmissionsCampaignSchedule;
}

export function buildStudyAbroadAdmissionsCoverageSprintRoadmap(
  programs: StudyAbroadCatalogProgram[],
  state: StudyAbroadAdmissionsWarmupState,
  options?: {
    degree?: string;
    rounds?: number;
    maxCountries?: number;
    maxFocusPerCountry?: number;
    maxRecommendations?: number;
    strategy?: StudyAbroadAdmissionsStrategy;
  }
) {
  const rounds = Math.max(1, Math.min(Number(options?.rounds) || 3, 6));
  const virtualState = normalizeWarmupState(state);
  const usedKeys = new Set<string>();
  const roadmap: StudyAbroadAdmissionsCoverageSprintRoadmapRound[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const basePlan = buildStudyAbroadAdmissionsCoverageSprintPlan(programs, virtualState, options);
    const filteredItems = basePlan.items.filter((item) => {
      return !usedKeys.has(
        toCoverageSprintItemKey({
          country: item.country,
          degree: item.degree,
          major: item.major,
          specialization: item.specialization,
        })
      );
    });
    const items = filteredItems.length ? filteredItems : basePlan.items;

    if (!items.length) {
      break;
    }

    const plan = {
      ...basePlan,
      items,
      countries: Array.from(new Set(items.map((item) => item.country))).filter(Boolean),
      estimatedPrograms: items.reduce(
        (total, item) => total + Math.max(1, Number(item.maxPrograms) || 0),
        0
      ),
      summary: `第 ${round} 轮建议先跑 ${items.length} 组任务，覆盖 ${Array.from(new Set(items.map((item) => item.country))).length} 个国家 / 地区。`,
    } satisfies StudyAbroadAdmissionsCoverageSprintPlan;

    roadmap.push({
      round,
      plan,
    });

    const virtualRunAt = new Date(Date.now() + round * 60 * 1000).toISOString();
    items.forEach((item) => {
      usedKeys.add(
        toCoverageSprintItemKey({
          country: item.country,
          degree: item.degree,
          major: item.major,
          specialization: item.specialization,
        })
      );
      virtualState.lastRecommendationRuns[item.id] = virtualRunAt;
      virtualState.lastCountryRuns[item.country] = virtualRunAt;
    });
    virtualState.updatedAt = virtualRunAt;
  }

  return roadmap;
}

export async function readStudyAbroadAdmissionsCoverageSprintRoadmap(options?: {
  degree?: string;
  rounds?: number;
  maxCountries?: number;
  maxFocusPerCountry?: number;
  maxRecommendations?: number;
}) {
  const [programs, state, strategy] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);

  return buildStudyAbroadAdmissionsCoverageSprintRoadmap(programs, state, {
    ...options,
    strategy,
  });
}

export async function executeStudyAbroadAdmissionsCountryTargetPlan(options?: {
  country?: string;
  maxCountries?: number;
  maxFocusPerCountry?: number;
  degree?: string;
}) {
  const country = String(options?.country ?? "").trim();
  const degree = String(options?.degree ?? "").trim() || "硕士";
  const maxCountries = Math.max(1, Math.min(Number(options?.maxCountries) || 2, 6));
  const maxFocusPerCountry = Math.max(
    1,
    Math.min(Number(options?.maxFocusPerCountry) || 2, 4)
  );
  const [plans, warmupState, strategy] = await Promise.all([
    readStudyAbroadAdmissionsCountryTargetPlans({
      degree,
      countries: country ? [country] : undefined,
      limit: country ? 8 : Math.max(maxCountries * 2, 6),
      focusLimit: maxFocusPerCountry,
    }),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);
  const selectedPlans = country
    ? plans.filter((item) => item.country === country)
    : buildStudyAbroadAdmissionsCountryTargetExecutionQueue(
        plans,
        warmupState,
        { limit: maxCountries, strategy }
      );

  if (!selectedPlans.length) {
    return {
      ok: false,
      message: "当前没有可执行的国家目标补齐计划。",
      countryRuns: [],
    };
  }

  const countryRuns = [];
  const historyRuns: Array<{
    id: string;
    label: string;
    country: string;
    syncedCount?: number;
    okCount?: number;
    partialCount?: number;
    unavailableCount?: number;
  }> = [];

  for (const plan of selectedPlans) {
    const focusRecommendations = plan.focusRecommendations.length
      ? plan.focusRecommendations.slice(0, maxFocusPerCountry)
      : [
          {
            id: `${slugifyRecommendationPart(plan.country)}-baseline-${slugifyRecommendationPart(degree)}`,
            label: `${plan.country} · ${degree}基础覆盖`,
            description: plan.note,
            country: plan.country,
            degree,
            major: "",
            specialization: "",
            totalPrograms: plan.totalPrograms,
            syncedPrograms: plan.syncedPrograms,
            structuredPrograms: plan.structuredPrograms,
            completePrograms: plan.completePrograms,
            missingPrograms: plan.missingPrograms,
            structuredCoveragePercent: plan.structuredCoveragePercent,
            gapScore:
              plan.targetProgramGap * 20 +
              plan.strategicPriority * 18 +
              Math.min(plan.totalPrograms, 12),
            recommendationScore:
              plan.targetProgramGap * 20 +
              plan.strategicPriority * 18 +
              Math.min(plan.totalPrograms, 12),
            missingGapScore: 0,
            structuredGapScore: 0,
            completeGapScore: 0,
            targetGapScore: plan.targetProgramGap * 20,
            priorityScore: plan.strategicPriority * 18,
            volumeScore: Math.min(plan.totalPrograms, 12),
            recencyBoostScore: 0,
            recencyPenaltyScore: 0,
            maxPrograms: Math.min(10, Math.max(4, plan.targetProgramGap || 4)),
            lastRecommendationRunAt: "",
            lastRecommendationRunDays: Number.POSITIVE_INFINITY,
            lastRecommendationRunLabel: "未补过",
            recentlyRun: false,
            coolingDown: false,
            cooldownHours: strategy.focusCooldownHours,
            cooldownRemainingHours: 0,
            coolingDownUntil: "",
          } satisfies StudyAbroadAdmissionsCountryTargetFocusRecommendation,
        ];

    const focusRuns = [];

    for (const focus of focusRecommendations) {
      const result = await syncStudyAbroadAdmissionsSnapshots({
        mode: "missing-first",
        country: focus.country,
        degree: focus.degree,
        major: focus.major,
        specialization: focus.specialization,
        maxPrograms: focus.maxPrograms,
      });

      focusRuns.push({
        ...focus,
        ...result,
      });
      historyRuns.push({
        id: focus.id,
        label: `${focus.label}（国家目标）`,
        country: focus.country,
        syncedCount: result.syncedCount,
        okCount: result.okCount,
        partialCount: result.partialCount,
        unavailableCount: result.unavailableCount,
      });
    }

    countryRuns.push({
      country: plan.country,
      targetStructuredCoveragePercent: plan.targetStructuredCoveragePercent,
      currentStructuredCoveragePercent: plan.structuredCoveragePercent,
      targetGapPercent: plan.targetGapPercent,
      focusRuns,
      syncedCount: focusRuns.reduce((total, item) => total + Number(item.syncedCount || 0), 0),
      okCount: focusRuns.reduce((total, item) => total + Number(item.okCount || 0), 0),
      partialCount: focusRuns.reduce(
        (total, item) => total + Number(item.partialCount || 0),
        0
      ),
      unavailableCount: focusRuns.reduce(
        (total, item) => total + Number(item.unavailableCount || 0),
        0
      ),
    });
  }

  await recordStudyAbroadAdmissionsWarmupRuns("smart", historyRuns);

  const syncedCount = countryRuns.reduce(
    (total, item) => total + Number(item.syncedCount || 0),
    0
  );
  const okCount = countryRuns.reduce((total, item) => total + Number(item.okCount || 0), 0);
  const partialCount = countryRuns.reduce(
    (total, item) => total + Number(item.partialCount || 0),
    0
  );
  const unavailableCount = countryRuns.reduce(
    (total, item) => total + Number(item.unavailableCount || 0),
    0
  );

  return {
    ok: true,
    syncedCount,
    okCount,
    partialCount,
    unavailableCount,
    countryRuns,
    message:
      selectedPlans.length === 1
        ? `已按国家目标补齐“${selectedPlans[0].country}”的推荐方向，本轮同步 ${syncedCount} 个项目，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`
        : `已按国家目标补齐 ${selectedPlans.length} 个国家的推荐方向，本轮同步 ${syncedCount} 个项目，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`,
  };
}

export async function executeStudyAbroadAdmissionsCoverageSprint(options?: {
  degree?: string;
  maxCountries?: number;
  maxFocusPerCountry?: number;
  maxRecommendations?: number;
  recordCampaignRun?: boolean;
}) {
  const [beforePrograms, state, strategy] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);
  const plan = buildStudyAbroadAdmissionsCoverageSprintPlan(beforePrograms, state, {
    ...options,
    strategy,
  });

  if (!plan.items.length) {
    return {
      ok: false,
      message: "当前没有可执行的覆盖冲刺计划。",
      plan,
      sprintRuns: [],
    };
  }

  const beforeOverall = summarizeAdmissionsCoverage(beforePrograms);
  const beforeCountryMap = new Map(
    plan.countries.map((country) => [
      country,
      summarizeAdmissionsCoverage(beforePrograms, { countries: [country] }),
    ])
  );

  const sprintRuns = [];
  const focusBreakdown: StudyAbroadAdmissionsCampaignFocusBreakdown[] = [];
  const historyRuns: Array<{
    id: string;
    label: string;
    country: string;
    syncedCount?: number;
    okCount?: number;
    partialCount?: number;
    unavailableCount?: number;
  }> = [];

  for (const item of plan.items) {
    const beforeItemPrograms = await readStudyAbroadCatalogPrograms();
    const beforeItemCoverage = summarizeAdmissionsCoverage(beforeItemPrograms, {
      countries: [item.country],
      major: item.major,
      specialization: item.specialization,
    });
    const result = await syncStudyAbroadAdmissionsSnapshots({
      mode: "missing-first",
      country: item.country,
      degree: item.degree,
      major: item.major,
      specialization: item.specialization,
      maxPrograms: item.maxPrograms,
    });

    sprintRuns.push({
      ...item,
      ...result,
    });
    historyRuns.push({
      id: item.id,
      label: `${item.label}（覆盖冲刺）`,
      country: item.country,
      syncedCount: result.syncedCount,
      okCount: result.okCount,
      partialCount: result.partialCount,
      unavailableCount: result.unavailableCount,
    });

    const afterItemPrograms = await readStudyAbroadCatalogPrograms();
    const afterItemCoverage = summarizeAdmissionsCoverage(afterItemPrograms, {
      countries: [item.country],
      major: item.major,
      specialization: item.specialization,
    });

    focusBreakdown.push({
      id: item.id,
      label: item.label,
      country: item.country,
      major: item.major,
      specialization: item.specialization,
      syncedCount: result.syncedCount,
      okCount: result.okCount,
      partialCount: result.partialCount,
      unavailableCount: result.unavailableCount,
      structuredDelta:
        afterItemCoverage.structuredPrograms - beforeItemCoverage.structuredPrograms,
      completeDelta: afterItemCoverage.completePrograms - beforeItemCoverage.completePrograms,
    });
  }

  await recordStudyAbroadAdmissionsWarmupRuns("sprint", historyRuns);

  const afterPrograms = await readStudyAbroadCatalogPrograms();
  const afterOverall = summarizeAdmissionsCoverage(afterPrograms);
  const countryDeltas = plan.countries
    .map((country) => {
      const before = beforeCountryMap.get(country) ?? summarizeAdmissionsCoverage([], {});
      const after = summarizeAdmissionsCoverage(afterPrograms, { countries: [country] });

      return {
        country,
        before,
        after,
        syncedDelta: after.syncedPrograms - before.syncedPrograms,
        structuredDelta: after.structuredPrograms - before.structuredPrograms,
        completeDelta: after.completePrograms - before.completePrograms,
      };
    })
    .filter(
      (item) =>
        item.syncedDelta > 0 || item.structuredDelta > 0 || item.completeDelta > 0
    );

  const syncedCount = sprintRuns.reduce(
    (total, item) => total + Number(item.syncedCount || 0),
    0
  );
  const okCount = sprintRuns.reduce((total, item) => total + Number(item.okCount || 0), 0);
  const partialCount = sprintRuns.reduce(
    (total, item) => total + Number(item.partialCount || 0),
    0
  );
  const unavailableCount = sprintRuns.reduce(
    (total, item) => total + Number(item.unavailableCount || 0),
    0
  );
  const structuredDelta = afterOverall.structuredPrograms - beforeOverall.structuredPrograms;
  const completeDelta = afterOverall.completePrograms - beforeOverall.completePrograms;
  const syncedDelta = afterOverall.syncedPrograms - beforeOverall.syncedPrograms;
  const result = {
    ok: true,
    plan,
    sprintRuns,
    syncedCount,
    okCount,
    partialCount,
    unavailableCount,
    delta: {
      overall: {
        before: beforeOverall,
        after: afterOverall,
        syncedDelta,
        structuredDelta,
        completeDelta,
      },
      countries: countryDeltas,
    } satisfies StudyAbroadAdmissionsCoverageSprintDelta,
    focusBreakdown,
    message: `已完成一轮覆盖冲刺，执行 ${plan.items.length} 组任务，本轮同步 ${syncedCount} 个项目，新增 ${structuredDelta} 个结构化门槛、${completeDelta} 个完整门槛。`,
  };

  if (options?.recordCampaignRun !== false) {
    await recordStudyAbroadAdmissionsCampaignRun({
      runAt: new Date().toISOString(),
      mode: "sprint",
      degree: plan.degree,
      rounds: 1,
      itemCount: plan.items.length,
      countries: plan.countries,
      syncedCount,
      okCount,
      partialCount,
      unavailableCount,
      structuredDelta,
      completeDelta,
      countryBreakdown: result.delta.countries.map((entry) => ({
        country: entry.country,
        structuredDelta: entry.structuredDelta,
        completeDelta: entry.completeDelta,
      })),
      focusBreakdown: result.focusBreakdown,
    });
  }

  return result;
}

export async function executeStudyAbroadAdmissionsCoverageRoadmap(options?: {
  degree?: string;
  rounds?: number;
  maxCountries?: number;
  maxFocusPerCountry?: number;
  maxRecommendations?: number;
}) {
  const rounds = Math.max(1, Math.min(Number(options?.rounds) || 3, 5));
  const roadmapRuns: StudyAbroadAdmissionsCoverageRoadmapRun[] = [];
  const roadmapFocusBreakdown: StudyAbroadAdmissionsCampaignFocusBreakdown[] = [];

  for (let round = 1; round <= rounds; round += 1) {
    const result = await executeStudyAbroadAdmissionsCoverageSprint({
      degree: options?.degree,
      maxCountries: options?.maxCountries,
      maxFocusPerCountry: options?.maxFocusPerCountry,
      maxRecommendations: options?.maxRecommendations,
      recordCampaignRun: false,
    });

    if (!result.ok || !result.plan?.items?.length) {
      if (!roadmapRuns.length) {
        return {
          ok: false,
          message: result.message || "当前没有可执行的长期补齐批处理。",
          roadmapRuns: [],
        };
      }
      break;
    }

    roadmapRuns.push({
      round,
      plan: result.plan,
      syncedCount: result.syncedCount,
      okCount: result.okCount,
      partialCount: result.partialCount,
      unavailableCount: result.unavailableCount,
      delta: result.delta.overall,
      countryDelta: result.delta.countries,
    });
    roadmapFocusBreakdown.push(...result.focusBreakdown);
  }

  if (!roadmapRuns.length) {
    return {
      ok: false,
      message: "当前没有可执行的长期补齐批处理。",
      roadmapRuns: [],
    };
  }

  const syncedCount = roadmapRuns.reduce((total, item) => total + item.syncedCount, 0);
  const okCount = roadmapRuns.reduce((total, item) => total + item.okCount, 0);
  const partialCount = roadmapRuns.reduce((total, item) => total + item.partialCount, 0);
  const unavailableCount = roadmapRuns.reduce(
    (total, item) => total + item.unavailableCount,
    0
  );
  const firstDelta = roadmapRuns[0].delta.before;
  const lastDelta = roadmapRuns[roadmapRuns.length - 1].delta.after;
  const structuredDelta = lastDelta.structuredPrograms - firstDelta.structuredPrograms;
  const completeDelta = lastDelta.completePrograms - firstDelta.completePrograms;
  const syncedDelta = lastDelta.syncedPrograms - firstDelta.syncedPrograms;
  const countryBreakdownMap = new Map<
    string,
    StudyAbroadAdmissionsCampaignCountryBreakdown
  >();

  roadmapRuns
    .flatMap((item) => item.countryDelta)
    .forEach((entry) => {
      const current = countryBreakdownMap.get(entry.country) ?? {
        country: entry.country,
        structuredDelta: 0,
        completeDelta: 0,
      };
      current.structuredDelta += entry.structuredDelta;
      current.completeDelta += entry.completeDelta;
      countryBreakdownMap.set(entry.country, current);
    });

  await recordStudyAbroadAdmissionsCampaignRun({
    runAt: new Date().toISOString(),
    mode: "roadmap",
    degree: roadmapRuns[0].plan.degree,
    rounds: roadmapRuns.length,
    itemCount: roadmapRuns.reduce((total, item) => total + item.plan.items.length, 0),
    countries: Array.from(
      new Set(roadmapRuns.flatMap((item) => item.plan.countries))
    ).filter(Boolean),
    syncedCount,
    okCount,
    partialCount,
    unavailableCount,
    structuredDelta,
    completeDelta,
      countryBreakdown: Array.from(countryBreakdownMap.values()).filter(
        (entry) => entry.structuredDelta > 0 || entry.completeDelta > 0
      ),
    focusBreakdown: Array.from(
      roadmapFocusBreakdown.reduce((map, entry) => {
        const current = map.get(entry.id) ?? {
          ...entry,
          syncedCount: 0,
          okCount: 0,
          partialCount: 0,
          unavailableCount: 0,
          structuredDelta: 0,
          completeDelta: 0,
        };
        current.syncedCount += entry.syncedCount;
        current.okCount += entry.okCount;
        current.partialCount += entry.partialCount;
        current.unavailableCount += entry.unavailableCount;
        current.structuredDelta += entry.structuredDelta;
        current.completeDelta += entry.completeDelta;
        map.set(entry.id, current);
        return map;
      }, new Map<string, StudyAbroadAdmissionsCampaignFocusBreakdown>())
    ).map(([, entry]) => entry),
  });

  return {
    ok: true,
    roadmapRuns,
    syncedCount,
    okCount,
    partialCount,
    unavailableCount,
    delta: {
      before: firstDelta,
      after: lastDelta,
      syncedDelta,
      structuredDelta,
      completeDelta,
    },
    message: `已连续完成 ${roadmapRuns.length} 轮覆盖冲刺，共同步 ${syncedCount} 个项目，累计新增 ${structuredDelta} 个结构化门槛、${completeDelta} 个完整门槛。`,
  };
}

export async function executeStudyAbroadAdmissionsCampaignCadence(options?: {
  degree?: string;
  countries?: string[];
}) {
  const cadence = await readStudyAbroadAdmissionsCampaignCadence(options);
  const result = await executeStudyAbroadAdmissionsCoverageRoadmap({
    degree: cadence.degree,
    rounds: cadence.rounds,
    maxCountries: cadence.maxCountries,
    maxFocusPerCountry: cadence.maxFocusPerCountry,
    maxRecommendations: cadence.maxRecommendations,
  });

  return {
    ...result,
    cadence,
    message: result.ok
      ? `已按“${cadence.label}”节奏完成 ${result.roadmapRuns.length} 轮推进，共同步 ${result.syncedCount} 个项目，累计新增 ${result.delta.structuredDelta} 个结构化门槛、${result.delta.completeDelta} 个完整门槛。`
      : result.message,
  };
}

function computeSmartRecommendationBreakdown(
  item: Omit<StudyAbroadAdmissionsWarmupRecommendation, "smartScore">,
  state: StudyAbroadAdmissionsWarmupState,
  strategy: StudyAbroadAdmissionsStrategy
) {
  const recommendationDays = daysSince(state.lastRecommendationRuns[item.id]);
  const countryDays = daysSince(state.lastCountryRuns[item.country]);
  const recommendationHours = hoursSince(state.lastRecommendationRuns[item.id]);
  const countryHours = hoursSince(state.lastCountryRuns[item.country]);
  const neverRunRecommendation = !Number.isFinite(recommendationDays);
  const neverRunCountry = !Number.isFinite(countryDays);

  const recommendationPenalty = neverRunRecommendation
    ? 0
    : recommendationHours < strategy.smartRecommendationCooldownHours
      ? 32000 - recommendationHours * 200
      : recommendationDays < 14
      ? 30000 - recommendationDays * 1200
      : Math.max(0, 30 - recommendationDays) * 120;
  const countryPenalty = neverRunCountry
    ? 0
    : countryHours < strategy.countryCooldownHours
      ? 5400 - countryHours * 140
      : countryDays < 5
      ? 5000 - countryDays * 700
      : Math.max(0, 14 - countryDays) * 90;
  const freshnessBoost = neverRunRecommendation
    ? 320
    : Math.min(recommendationDays, 30) * 12;
  const countryBoost = neverRunCountry ? 140 : Math.min(countryDays, 30) * 6;
  const targetBoost =
    item.countryTargetGapPercent * 240 +
    item.countryStrategicPriority * 260 +
    Math.min(item.countryTargetProgramGap, 20) * 16;

  return {
    targetBoostScore: Math.round(targetBoost),
    freshnessBoostScore: Math.round(freshnessBoost),
    countryFreshnessBoostScore: Math.round(countryBoost),
    recommendationPenaltyScore: Math.round(recommendationPenalty),
    countryPenaltyScore: Math.round(countryPenalty),
    smartScore: Math.round(
      item.gapScore +
      targetBoost +
      freshnessBoost +
      countryBoost -
      recommendationPenalty -
      countryPenalty
    ),
  };
}

async function recordStudyAbroadAdmissionsWarmupRuns(
  mode: "preset" | "smart" | "sprint" | "direct",
  runs: Array<{
    id: string;
    label: string;
    country: string;
    syncedCount?: number;
    okCount?: number;
    partialCount?: number;
    unavailableCount?: number;
  }>
) {
  if (!runs.length) return DEFAULT_WARMUP_STATE;

  const current = await readStudyAbroadAdmissionsWarmupState();
  const now = new Date().toISOString();
  const history = [
    ...runs.map((item) => ({
      runAt: now,
      mode,
      recommendationId: item.id,
      country: item.country,
      label: item.label,
      syncedCount: Math.max(0, Number(item.syncedCount) || 0),
      okCount: Math.max(0, Number(item.okCount) || 0),
      partialCount: Math.max(0, Number(item.partialCount) || 0),
      unavailableCount: Math.max(0, Number(item.unavailableCount) || 0),
    })),
    ...current.history,
  ].slice(0, 30);

  const nextState = normalizeWarmupState({
    updatedAt: now,
    lastRecommendationRuns: {
      ...current.lastRecommendationRuns,
      ...Object.fromEntries(runs.map((item) => [item.id, now])),
    },
    lastCountryRuns: {
      ...current.lastCountryRuns,
      ...Object.fromEntries(runs.map((item) => [item.country, now])),
    },
    history,
  });

  await writeStudyAbroadAdmissionsWarmupState(nextState);
  return nextState;
}

function compareProgramsForAdmissionsSync(
  left: StudyAbroadCatalogProgram,
  right: StudyAbroadCatalogProgram
) {
  const leftMissing = snapshotNeedsRefresh(left, "missing-first") ? 1 : 0;
  const rightMissing = snapshotNeedsRefresh(right, "missing-first") ? 1 : 0;

  if (leftMissing !== rightMissing) {
    return rightMissing - leftMissing;
  }

  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }

  return right.checkedAt.localeCompare(left.checkedAt);
}

function toAdmissionsSnapshot(insight: Awaited<ReturnType<typeof readStudyAbroadAdmissionsInsight>>) {
  if (!insight) return null;

  return {
    extractedAt: insight.fetchedAt,
    extractionStatus: insight.extractionStatus,
    gpaMin: insight.admissionsProfile.gpaMin,
    gpaScale: insight.admissionsProfile.gpaScale,
    ieltsMin: insight.admissionsProfile.ieltsMin,
    toeflMin: insight.admissionsProfile.toeflMin,
    duolingoMin: insight.admissionsProfile.duolingoMin,
    pteMin: insight.admissionsProfile.pteMin,
    greStatus: insight.admissionsProfile.greStatus,
    gmatStatus: insight.admissionsProfile.gmatStatus,
    workExperienceYears: insight.admissionsProfile.workExperienceYears,
  } satisfies StudyAbroadCatalogAdmissionsSnapshot;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runWorker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );

  return results;
}

function normalizeProgramIdList(programIds: string[] | undefined) {
  return Array.isArray(programIds)
    ? Array.from(
        new Set(
          programIds.map((item) => String(item ?? "").trim()).filter(Boolean)
        )
      )
    : [];
}

function selectAdmissionsSyncCandidates(
  programs: StudyAbroadCatalogProgram[],
  options: AdmissionsSyncOptions,
  limits?: { maxProgramsCap?: number }
) {
  const mode = normalizeSyncMode(String(options?.mode ?? ""));
  const country = String(options?.country ?? "").trim();
  const degree = String(options?.degree ?? "").trim();
  const major = String(options?.major ?? "").trim();
  const specialization = String(options?.specialization ?? "").trim();
  const requestedIds = normalizeProgramIdList(options?.programIds);
  const requestedIdSet = requestedIds.length ? new Set(requestedIds) : null;
  const maxPrograms = Math.max(
    1,
    Math.min(
      Number(options?.maxPrograms) || DEFAULT_MAX_PROGRAMS,
      limits?.maxProgramsCap ?? MAX_PROGRAMS
    )
  );

  const syncablePrograms = programs
    .filter((program) => (requestedIdSet ? requestedIdSet.has(program.id) : true))
    .filter((program) => (country ? program.country === country : true))
    .filter((program) =>
      degree === "本科" || degree === "硕士" || degree === "博士"
        ? program.degree === degree
        : true
    )
    .filter((program) =>
      requestedIdSet ? true : matchesDirection(program, major, specialization)
    )
    .filter((program) => program.admissionsUrl || program.overviewUrl || program.tuitionUrl)
    .sort(compareProgramsForAdmissionsSync);

  const unlockedPrograms = syncablePrograms.filter(
    (program) => !IN_FLIGHT_PROGRAM_IDS.has(program.id)
  );

  const candidates =
    mode === "refresh-all"
      ? unlockedPrograms.slice(0, maxPrograms)
      : unlockedPrograms
          .filter((program) => snapshotNeedsRefresh(program, mode))
          .slice(0, maxPrograms);

  return {
    mode,
    country,
    degree,
    major,
    specialization,
    requestedIds,
    maxPrograms,
    syncablePrograms,
    candidates,
    skippedInFlightCount: Math.max(0, syncablePrograms.length - unlockedPrograms.length),
  };
}

async function syncAdmissionsCandidates(
  programs: StudyAbroadCatalogProgram[],
  candidates: StudyAbroadCatalogProgram[]
) {
  const synced = await mapWithConcurrency(candidates, CONCURRENCY, async (program) => {
    IN_FLIGHT_PROGRAM_IDS.add(program.id);

    try {
      const insight = await readStudyAbroadAdmissionsInsight(program.id);
      return {
        programId: program.id,
        snapshot: toAdmissionsSnapshot(insight),
        extractionStatus: insight?.extractionStatus ?? "unavailable",
      };
    } finally {
      IN_FLIGHT_PROGRAM_IDS.delete(program.id);
    }
  });

  const snapshotMap = new Map(
    synced
      .filter((item) => item.snapshot)
      .map((item) => [item.programId, item.snapshot as StudyAbroadCatalogAdmissionsSnapshot])
  );

  const nextPrograms = programs.map((program) =>
    snapshotMap.has(program.id)
      ? {
          ...program,
          admissionsSnapshot: snapshotMap.get(program.id) ?? null,
        }
      : program
  );

  await writeStudyAbroadCatalogPrograms(nextPrograms);

  return {
    synced,
    nextPrograms,
    snapshotMap,
  };
}

export async function syncStudyAbroadAdmissionsSnapshots(options?: AdmissionsSyncOptions) {
  const programs = await readStudyAbroadCatalogPrograms();
  const {
    mode,
    country,
    degree,
    major,
    specialization,
    syncablePrograms,
    candidates,
    skippedInFlightCount,
  } = selectAdmissionsSyncCandidates(programs, options);

  if (!candidates.length) {
    const onlyInFlight =
      Boolean(skippedInFlightCount) && skippedInFlightCount === syncablePrograms.length;
    if (options?.recordHistory && country) {
      await recordStudyAbroadAdmissionsWarmupRuns("direct", [
        {
          id: buildAdmissionsSyncHistoryId(options),
          label: `${buildAdmissionsSyncHistoryLabel(options)}（定向同步）`,
          country,
          syncedCount: 0,
          okCount: 0,
          partialCount: 0,
          unavailableCount: 0,
        },
      ]);
    }

    return {
      ok: true,
      syncedCount: 0,
      okCount: 0,
      partialCount: 0,
      unavailableCount: 0,
      skippedFreshCount: syncablePrograms.length,
      skippedInFlightCount,
      mode,
      message:
        onlyInFlight
          ? "当前筛选范围内的门槛快照正在后台补抓中，稍后刷新即可看到更新。"
          : country || degree || major || specialization
            ? "当前筛选范围内没有需要同步的招生门槛快照，现有快照都还在有效期内。"
            : "当前没有需要同步的招生门槛快照，现有快照都还在有效期内。",
      filters: {
        country,
        degree,
        major,
        specialization,
      },
    };
  }

  const { synced, nextPrograms } = await syncAdmissionsCandidates(programs, candidates);

  const okCount = synced.filter((item) => item.extractionStatus === "ok").length;
  const partialCount = synced.filter((item) => item.extractionStatus === "partial").length;
  const unavailableCount = synced.filter(
    (item) => item.extractionStatus === "unavailable"
  ).length;

  if (options?.recordHistory && country) {
    await recordStudyAbroadAdmissionsWarmupRuns("direct", [
      {
        id: buildAdmissionsSyncHistoryId(options),
        label: `${buildAdmissionsSyncHistoryLabel(options)}（定向同步）`,
        country,
        syncedCount: synced.length,
        okCount,
        partialCount,
        unavailableCount,
      },
    ]);
  }

  return {
    ok: true,
    syncedCount: synced.length,
    okCount,
    partialCount,
    unavailableCount,
    skippedFreshCount: Math.max(0, syncablePrograms.length - candidates.length),
    skippedInFlightCount,
    mode,
    message:
      mode === "refresh-all"
        ? `已强制刷新 ${synced.length} 个项目的招生门槛快照，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`
        : `已同步 ${synced.length} 个项目的招生门槛快照，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`,
    filters: {
      country,
      degree,
      major,
      specialization,
    },
  };
}

export async function prefetchStudyAbroadAdmissionsSnapshots(options?: AdmissionsSyncOptions) {
  const programs = await readStudyAbroadCatalogPrograms();
  const {
    country,
    degree,
    major,
    specialization,
    candidates,
  } = selectAdmissionsSyncCandidates(programs, options, {
    maxProgramsCap: PREFETCH_MAX_PROGRAMS,
  });

  if (!candidates.length) {
    return {
      ok: true,
      syncedCount: 0,
      okCount: 0,
      partialCount: 0,
      unavailableCount: 0,
      updatedPrograms: [],
      message: "当前前排项目没有需要补抓的招生门槛，或这些项目正在后台同步中。",
      filters: {
        country,
        degree,
        major,
        specialization,
      },
    };
  }

  const { synced, nextPrograms } = await syncAdmissionsCandidates(programs, candidates);
  const nextProgramMap = new Map(nextPrograms.map((program) => [program.id, program]));
  const updatedPrograms = synced
    .map((item) => nextProgramMap.get(item.programId))
    .filter((program): program is StudyAbroadCatalogProgram => Boolean(program))
    .map((program) => ({
      id: program.id,
      admissionsSnapshot: program.admissionsSnapshot ?? null,
    }));

  return {
    ok: true,
    syncedCount: synced.length,
    okCount: synced.filter((item) => item.extractionStatus === "ok").length,
    partialCount: synced.filter((item) => item.extractionStatus === "partial").length,
    unavailableCount: synced.filter((item) => item.extractionStatus === "unavailable").length,
    updatedPrograms,
    filters: {
      country,
      degree,
      major,
      specialization,
    },
  };
}

export function getStudyAbroadAdmissionsWarmupPresets() {
  return [...ADMISSIONS_WARMUP_PRESETS];
}

export function buildStudyAbroadAdmissionsWarmupRecommendations(
  programs: StudyAbroadCatalogProgram[],
  options?: {
    limit?: number;
    degree?: string;
    countries?: string[];
    state?: StudyAbroadAdmissionsWarmupState;
    strategy?: StudyAbroadAdmissionsStrategy;
  }
) {
  const limit = Math.max(1, Math.min(Number(options?.limit) || 8, 20));
  const degreeFilter = String(options?.degree ?? "").trim();
  const countryFilterSet =
    Array.isArray(options?.countries) && options?.countries.length
      ? new Set(options.countries.map((item) => String(item ?? "").trim()).filter(Boolean))
      : null;
  const state = normalizeWarmupState(options?.state ?? DEFAULT_WARMUP_STATE);
  const strategy = normalizeStrategy(options?.strategy ?? DEFAULT_STRATEGY);
  const filteredPrograms = programs
    .filter((program) => (degreeFilter ? program.degree === degreeFilter : true))
    .filter((program) => (countryFilterSet ? countryFilterSet.has(program.country) : true))
    .filter((program) => Boolean(program.country && program.degree && program.discipline));
  const countryTargetStatusMap =
    buildStudyAbroadAdmissionsCountryTargetStatusesFromPrograms(filteredPrograms);
  const countryTargetPlans = buildStudyAbroadAdmissionsCountryTargetPlans(filteredPrograms, {
    degree: degreeFilter || "硕士",
    countries: countryFilterSet ? Array.from(countryFilterSet) : undefined,
    limit: 20,
    focusLimit: 2,
    state,
    strategy,
  });

  const groupMap = new Map<string, StudyAbroadAdmissionsWarmupRecommendation>();

  filteredPrograms.forEach((program) => {
      const country = program.country;
      const degree = program.degree;
      const major = program.discipline;
      const specialization = "";
      const key = `${country}__${degree}__${major}`;
      const countryTarget =
        countryTargetStatusMap.get(country) ??
        ({
          ...getCountryTarget(country),
          totalPrograms: 0,
          syncedPrograms: 0,
          structuredPrograms: 0,
          completePrograms: 0,
          missingPrograms: 0,
          syncedCoveragePercent: 0,
          structuredCoveragePercent: 0,
          completeCoveragePercent: 0,
          targetGapPercent: 0,
          targetProgramGap: 0,
          status: "behind",
        } satisfies StudyAbroadAdmissionsCountryTargetStatus);
      const current = groupMap.get(key) ?? {
        id: `${slugifyRecommendationPart(country)}-${slugifyRecommendationPart(major)}-${slugifyRecommendationPart(degree)}`,
        label: `${country} · ${major} · ${degree}`,
        description: `优先补 ${country}${major}${degree}项目的官网门槛，让这一组搜索更快进入可比对状态。`,
        country,
        degree,
        major,
        specialization,
        totalPrograms: 0,
        syncedPrograms: 0,
        structuredPrograms: 0,
        completePrograms: 0,
        missingPrograms: 0,
        gapScore: 0,
        smartScore: 0,
        targetBoostScore: 0,
        freshnessBoostScore: 0,
        countryFreshnessBoostScore: 0,
        recommendationPenaltyScore: 0,
        countryPenaltyScore: 0,
        maxPrograms: 4,
        countryStructuredCoveragePercent: countryTarget.structuredCoveragePercent,
        countryTargetCoveragePercent: countryTarget.targetStructuredCoveragePercent,
        countryTargetGapPercent: countryTarget.targetGapPercent,
        countryTargetProgramGap: countryTarget.targetProgramGap,
        countryStrategicPriority: countryTarget.strategicPriority,
        countryTargetNote: countryTarget.note,
      };

      const coverage = getAdmissionsCoverageFlags(program);
      current.totalPrograms += 1;
      if (coverage.synced) current.syncedPrograms += 1;
      if (coverage.structured) current.structuredPrograms += 1;
      if (coverage.complete) current.completePrograms += 1;
      if (coverage.missing) current.missingPrograms += 1;

      groupMap.set(key, current);
    });

  const focusWarmupRecommendations = countryTargetPlans
    .filter((plan) => plan.targetGapPercent > 0)
    .flatMap((plan) =>
      plan.focusRecommendations
        .filter((focus) => {
          const key = `${focus.country}__${focus.degree}__${focus.major}`;
          const existingGroup = groupMap.get(key);
          const minThreshold = plan.strategicPriority >= 4 ? 2 : 3;
          return !existingGroup || existingGroup.totalPrograms < minThreshold;
        })
        .map((focus) => {
          const recommendation = {
            id: focus.id,
            label: focus.label,
            description: `${focus.description} 当前属于 ${focus.country} 的国家目标优先方向。`,
            country: focus.country,
            degree: focus.degree,
            major: focus.major,
            specialization: focus.specialization,
            totalPrograms: focus.totalPrograms,
            syncedPrograms: focus.syncedPrograms,
            structuredPrograms: focus.structuredPrograms,
            completePrograms: focus.completePrograms,
            missingPrograms: focus.missingPrograms,
            gapScore: focus.gapScore + Math.min(plan.targetGapPercent, 40) * 6,
            smartScore: 0,
            targetBoostScore: 0,
            freshnessBoostScore: 0,
            countryFreshnessBoostScore: 0,
            recommendationPenaltyScore: 0,
            countryPenaltyScore: 0,
            maxPrograms: focus.maxPrograms,
            countryStructuredCoveragePercent: plan.structuredCoveragePercent,
            countryTargetCoveragePercent: plan.targetStructuredCoveragePercent,
            countryTargetGapPercent: plan.targetGapPercent,
            countryTargetProgramGap: plan.targetProgramGap,
            countryStrategicPriority: plan.strategicPriority,
            countryTargetNote: plan.note,
          } satisfies StudyAbroadAdmissionsWarmupRecommendation;

          return {
            ...recommendation,
            ...computeSmartRecommendationBreakdown(recommendation, state, strategy),
          };
        })
    );

  const sorted = Array.from(groupMap.values())
    .map((item) => {
      const mastersBias = item.degree === "硕士" ? 12 : item.degree === "博士" ? 6 : 3;
      const structuredGap = item.totalPrograms - item.structuredPrograms;
      const completeGap = item.totalPrograms - item.completePrograms;
      const gapScore =
        item.missingPrograms * 5 +
        structuredGap * 3 +
        completeGap * 2 +
        mastersBias +
        Math.min(item.totalPrograms, 20);
      const maxPrograms = Math.min(10, Math.max(4, Math.ceil(item.missingPrograms / 3)));

      return {
        ...item,
        gapScore,
        smartScore: 0,
        targetBoostScore: 0,
        freshnessBoostScore: 0,
        countryFreshnessBoostScore: 0,
        recommendationPenaltyScore: 0,
        countryPenaltyScore: 0,
        maxPrograms,
      };
    })
    .filter((item) => item.totalPrograms >= (item.countryStrategicPriority >= 4 ? 2 : 3))
    .filter((item) => item.missingPrograms > 0 || item.structuredPrograms < item.totalPrograms)
    .sort((left, right) => {
      if (left.gapScore !== right.gapScore) {
        return right.gapScore - left.gapScore;
      }
      if (left.missingPrograms !== right.missingPrograms) {
        return right.missingPrograms - left.missingPrograms;
      }
      if (left.totalPrograms !== right.totalPrograms) {
        return right.totalPrograms - left.totalPrograms;
      }
      return left.label.localeCompare(right.label, "zh-CN");
    })
      .map((item) => ({
        ...item,
        ...computeSmartRecommendationBreakdown(item, state, strategy),
      }))
    .concat(focusWarmupRecommendations)
    .concat(
      Array.from(countryTargetStatusMap.values())
        .filter((item) => item.totalPrograms >= 2)
        .filter((item) => item.targetGapPercent > 0)
        .filter(
          (item) =>
            !groupMap.has(`${item.country}__${degreeFilter || "硕士"}__全部方向`)
        )
        .map((item) => {
          const baselineRecommendation = {
            id: `${slugifyRecommendationPart(item.country)}-baseline-${slugifyRecommendationPart(
              degreeFilter || "硕士"
            )}`,
            label: `${item.country} · ${degreeFilter || "硕士"}基础覆盖`,
            description: `先把${item.country}${degreeFilter || "硕士"}项目的基础门槛补到目标线，再慢慢往细分方向铺开。`,
            country: item.country,
            degree: degreeFilter || "硕士",
            major: "",
            specialization: "",
            totalPrograms: item.totalPrograms,
            syncedPrograms: item.syncedPrograms,
            structuredPrograms: item.structuredPrograms,
            completePrograms: item.completePrograms,
            missingPrograms: item.missingPrograms,
            gapScore:
              Math.min(item.missingPrograms, 12) * 6 +
              Math.min(item.targetProgramGap, 12) * 20 +
              item.targetGapPercent * 18 +
              item.strategicPriority * 30,
            smartScore: 0,
            targetBoostScore: 0,
            freshnessBoostScore: 0,
            countryFreshnessBoostScore: 0,
            recommendationPenaltyScore: 0,
            countryPenaltyScore: 0,
            maxPrograms: Math.min(10, Math.max(4, item.targetProgramGap || 4)),
            countryStructuredCoveragePercent: item.structuredCoveragePercent,
            countryTargetCoveragePercent: item.targetStructuredCoveragePercent,
            countryTargetGapPercent: item.targetGapPercent,
            countryTargetProgramGap: item.targetProgramGap,
            countryStrategicPriority: item.strategicPriority,
            countryTargetNote: item.note,
          } satisfies StudyAbroadAdmissionsWarmupRecommendation;

          return {
            ...baselineRecommendation,
            ...computeSmartRecommendationBreakdown(
              baselineRecommendation,
              state,
              strategy
            ),
          };
        })
    )
    .sort((left, right) => {
      if (left.smartScore !== right.smartScore) {
        return right.smartScore - left.smartScore;
      }
      if (left.gapScore !== right.gapScore) {
        return right.gapScore - left.gapScore;
      }
      return left.label.localeCompare(right.label, "zh-CN");
    });

  const diversified: StudyAbroadAdmissionsWarmupRecommendation[] = [];
  const countryBuckets = new Map<string, StudyAbroadAdmissionsWarmupRecommendation[]>();
  sorted.forEach((item) => {
    const bucket = countryBuckets.get(item.country) ?? [];
    bucket.push(item);
    countryBuckets.set(item.country, bucket);
  });

  const topPerCountryCandidates = Array.from(countryBuckets.entries())
    .map(([country, bucket]) => ({
      country,
      item: bucket[0],
      lastCountryRunAt: state.lastCountryRuns[country] || "",
    }))
    .sort((left, right) => {
      const leftDays = daysSince(left.lastCountryRunAt);
      const rightDays = daysSince(right.lastCountryRunAt);

      if (leftDays !== rightDays) {
        return rightDays - leftDays;
      }

      if (left.item.smartScore !== right.item.smartScore) {
        return right.item.smartScore - left.item.smartScore;
      }

      return left.country.localeCompare(right.country, "zh-CN");
    });
  const topPerCountry = topPerCountryCandidates.filter(
    (entry) => entry.item.smartScore > 0 || entry.item.countryTargetGapPercent > 0
  );
  const firstPass = topPerCountry.length ? topPerCountry : topPerCountryCandidates;

  const countryCounts = new Map<string, number>();

  for (const entry of firstPass) {
    diversified.push(entry.item);
    countryCounts.set(entry.country, 1);

    if (diversified.length >= limit) {
      return diversified;
    }
  }

  const positivePool = sorted.filter(
    (item) => item.smartScore > 0 || item.countryTargetGapPercent > 0
  );

  for (const item of positivePool) {
    if (diversified.some((entry) => entry.id === item.id)) {
      continue;
    }

    const currentCountryCount = countryCounts.get(item.country) ?? 0;
    if (currentCountryCount >= 2) {
      continue;
    }

    diversified.push(item);
    countryCounts.set(item.country, currentCountryCount + 1);

    if (diversified.length >= limit) {
      return diversified;
    }
  }

  const fallbackPool = positivePool.length >= limit ? positivePool : sorted;

  for (const item of fallbackPool) {
    if (diversified.some((entry) => entry.id === item.id)) {
      continue;
    }

    diversified.push(item);
    if (diversified.length >= limit) {
      break;
    }
  }

  return diversified;
}

export async function readStudyAbroadAdmissionsWarmupRecommendations(options?: {
  limit?: number;
  degree?: string;
  countries?: string[];
}) {
  const [programs, state, strategy] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadAdmissionsWarmupState(),
    readStudyAbroadAdmissionsStrategy(),
  ]);
  return buildStudyAbroadAdmissionsWarmupRecommendations(programs, {
    ...options,
    state,
    strategy,
  });
}

export async function warmStudyAbroadAdmissionsCoverage(options?: {
  presetId?: string;
  maxPresets?: number;
}) {
  const presetId = String(options?.presetId ?? "").trim();
  const selectedPresets = presetId
    ? ADMISSIONS_WARMUP_PRESETS.filter((preset) => preset.id === presetId)
    : ADMISSIONS_WARMUP_PRESETS.slice(
        0,
        Math.max(1, Math.min(Number(options?.maxPresets) || ADMISSIONS_WARMUP_PRESETS.length, ADMISSIONS_WARMUP_PRESETS.length))
      );

  if (!selectedPresets.length) {
    return {
      ok: false,
      message: "没有找到可执行的门槛预热预设。",
      presetRuns: [],
    };
  }

  const presetRuns = [];

  for (const preset of selectedPresets) {
    const result = await syncStudyAbroadAdmissionsSnapshots({
      mode: "missing-first",
      country: preset.country,
      degree: preset.degree,
      major: preset.major,
      specialization: preset.specialization,
      maxPrograms: preset.maxPrograms,
    });

    presetRuns.push({
      ...preset,
      ...result,
    });
  }

  const syncedCount = presetRuns.reduce(
    (total, item) => total + Number(item.syncedCount || 0),
    0
  );
  const okCount = presetRuns.reduce(
    (total, item) => total + Number(item.okCount || 0),
    0
  );
  const partialCount = presetRuns.reduce(
    (total, item) => total + Number(item.partialCount || 0),
    0
  );
  const unavailableCount = presetRuns.reduce(
    (total, item) => total + Number(item.unavailableCount || 0),
    0
  );
  await recordStudyAbroadAdmissionsWarmupRuns("preset", presetRuns);

  return {
    ok: true,
    syncedCount,
    okCount,
    partialCount,
    unavailableCount,
    presetRuns,
    message:
      selectedPresets.length === 1
        ? `已完成“${selectedPresets[0].label}”门槛预热，本轮同步 ${syncedCount} 个项目，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`
        : `已完成 ${selectedPresets.length} 组热门方向门槛预热，本轮同步 ${syncedCount} 个项目，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`,
  };
}

export async function smartWarmStudyAbroadAdmissionsCoverage(options?: {
  recommendationId?: string;
  maxRecommendations?: number;
}) {
  const recommendationId = String(options?.recommendationId ?? "").trim();
  const recommendations = await readStudyAbroadAdmissionsWarmupRecommendations({
    limit: recommendationId
      ? 20
      : Math.max(1, Math.min(Number(options?.maxRecommendations) || 3, 10)),
    degree: "硕士",
  });
  const selectedRecommendations = recommendationId
    ? recommendations.filter((item) => item.id === recommendationId)
    : recommendations.slice(
        0,
        Math.max(1, Math.min(Number(options?.maxRecommendations) || 3, recommendations.length))
      );

  if (!selectedRecommendations.length) {
    return {
      ok: false,
      message: "当前没有可执行的智能预热建议。",
      recommendationRuns: [],
    };
  }

  const recommendationRuns = [];

  for (const recommendation of selectedRecommendations) {
    const result = await syncStudyAbroadAdmissionsSnapshots({
      mode: "missing-first",
      country: recommendation.country,
      degree: recommendation.degree,
      major: recommendation.major,
      specialization: recommendation.specialization,
      maxPrograms: recommendation.maxPrograms,
    });

    recommendationRuns.push({
      ...recommendation,
      ...result,
    });
  }

  const syncedCount = recommendationRuns.reduce(
    (total, item) => total + Number(item.syncedCount || 0),
    0
  );
  const okCount = recommendationRuns.reduce(
    (total, item) => total + Number(item.okCount || 0),
    0
  );
  const partialCount = recommendationRuns.reduce(
    (total, item) => total + Number(item.partialCount || 0),
    0
  );
  const unavailableCount = recommendationRuns.reduce(
    (total, item) => total + Number(item.unavailableCount || 0),
    0
  );
  await recordStudyAbroadAdmissionsWarmupRuns("smart", recommendationRuns);

  return {
    ok: true,
    syncedCount,
    okCount,
    partialCount,
    unavailableCount,
    recommendationRuns,
    message:
      selectedRecommendations.length === 1
        ? `已完成“${selectedRecommendations[0].label}”智能预热，本轮同步 ${syncedCount} 个项目，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`
        : `已按缺口优先完成 ${selectedRecommendations.length} 组智能预热，本轮同步 ${syncedCount} 个项目，其中 ${okCount} 个提取较完整，${partialCount} 个提取部分字段，${unavailableCount} 个仍待补抓。`,
  };
}
