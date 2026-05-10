import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dataFilePath } from "./json-file-store";
import {
  readStudyAbroadCatalogPrograms,
  readStudyAbroadCatalogSummary,
  writeStudyAbroadCatalogPrograms,
} from "./study-abroad-catalog-store";
import { syncGlobalStudyAbroadUniversityCatalog } from "./study-abroad-global-import";
import { syncUsStudyAbroadCatalog } from "./study-abroad-us-import";
import { syncUkStudyAbroadPilotPrograms } from "./study-abroad-uk-seed";
import { syncFocusStudyAbroadPilotPrograms } from "./study-abroad-focus-seed";
import { readStudyAbroadCachedAdmissionsInsights } from "./study-abroad-admissions";

const CATALOG_SYNC_STATE_FILE = "study-abroad-catalog-sync-state.json";
const COLLEGE_SCORECARD_API_KEY =
  import.meta.env?.COLLEGE_SCORECARD_API_KEY ||
  process.env.COLLEGE_SCORECARD_API_KEY ||
  "";

type CatalogSyncSourceId =
  | "global-universities"
  | "us-pilot"
  | "uk-pilot"
  | "focus-pilot"
  | "cache-restore";

export type StudyAbroadCatalogSyncSnapshot = {
  universityCount: number;
  programCount: number;
  countryCount: number;
  tuitionCoverage: number;
  admissionsCoverage: number;
  structuredAdmissionsCoverage: number;
};

export type StudyAbroadCatalogSyncSourceRun = {
  id: CatalogSyncSourceId;
  label: string;
  ok: boolean;
  message: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  metrics: Record<string, number | boolean | string>;
};

export type StudyAbroadCatalogSyncRun = {
  runAt: string;
  mode: "manual" | "auto";
  trigger: "dashboard" | "automation" | "script";
  ok: boolean;
  sourceRuns: StudyAbroadCatalogSyncSourceRun[];
  before: StudyAbroadCatalogSyncSnapshot;
  after: StudyAbroadCatalogSyncSnapshot;
  delta: {
    universityCount: number;
    programCount: number;
    countryCount: number;
    tuitionCoverage: number;
    admissionsCoverage: number;
    structuredAdmissionsCoverage: number;
  };
  message: string;
};

export type StudyAbroadCatalogSyncState = {
  updatedAt: string;
  runs: StudyAbroadCatalogSyncRun[];
};

export type StudyAbroadCatalogSyncOptions = {
  includeGlobal?: boolean;
  includeUs?: boolean;
  includeUk?: boolean;
  includeFocus?: boolean;
  usMaxPages?: number;
  usPerPage?: number;
  mode?: "manual" | "auto";
  trigger?: "dashboard" | "automation" | "script";
};

export type StudyAbroadCatalogSyncSelection = {
  includeGlobal: boolean;
  includeUs: boolean;
  includeUk: boolean;
  includeFocus: boolean;
  skippedUsForDemoKey: boolean;
  scorecardMode: "official-key" | "demo-key-skip-us";
};

type CatalogSyncTask = {
  id: CatalogSyncSourceId;
  label: string;
  run: () => Promise<unknown>;
};

const DEFAULT_SYNC_STATE: StudyAbroadCatalogSyncState = {
  updatedAt: "",
  runs: [],
};

export function hasOfficialCollegeScorecardApiKey() {
  const value = String(COLLEGE_SCORECARD_API_KEY || "").trim();
  return Boolean(value && value !== "DEMO_KEY");
}

export function resolveStudyAbroadCatalogSyncSelection(
  options: StudyAbroadCatalogSyncOptions = {}
): StudyAbroadCatalogSyncSelection {
  const includeGlobal = options.includeGlobal !== false;
  const includeUk = options.includeUk !== false;
  const includeFocus = options.includeFocus !== false;
  const requestedUs = options.includeUs !== false;
  const hasOfficialScorecardKey = hasOfficialCollegeScorecardApiKey();
  const includeUs = requestedUs && hasOfficialScorecardKey;

  return {
    includeGlobal,
    includeUs,
    includeUk,
    includeFocus,
    skippedUsForDemoKey: requestedUs && !hasOfficialScorecardKey,
    scorecardMode: hasOfficialScorecardKey ? "official-key" : "demo-key-skip-us",
  };
}

function toSnapshot(summary: Awaited<ReturnType<typeof readStudyAbroadCatalogSummary>>) {
  return {
    universityCount: summary.stats.universityCount,
    programCount: summary.stats.programCount,
    countryCount: summary.stats.countryCount,
    tuitionCoverage: summary.stats.tuitionCoverage,
    admissionsCoverage: summary.stats.admissionsCoverage,
    structuredAdmissionsCoverage: summary.stats.structuredAdmissionsCoverage,
  } satisfies StudyAbroadCatalogSyncSnapshot;
}

function normalizeSyncState(
  input: Partial<StudyAbroadCatalogSyncState> | null | undefined
) {
  return {
    updatedAt: String(input?.updatedAt ?? "").trim(),
    runs: Array.isArray(input?.runs)
      ? input.runs
          .map((run) => ({
            runAt: String(run?.runAt ?? "").trim(),
            mode: run?.mode === "auto" ? "auto" : "manual",
            trigger:
              run?.trigger === "automation" || run?.trigger === "script"
                ? run.trigger
                : "dashboard",
            ok: Boolean(run?.ok),
            sourceRuns: Array.isArray(run?.sourceRuns)
              ? run.sourceRuns
                  .map((sourceRun) => ({
                    id:
                      sourceRun?.id === "global-universities" ||
                      sourceRun?.id === "uk-pilot" ||
                      sourceRun?.id === "focus-pilot" ||
                      sourceRun?.id === "cache-restore"
                        ? sourceRun.id
                        : "us-pilot",
                    label: String(sourceRun?.label ?? "").trim(),
                    ok: Boolean(sourceRun?.ok),
                    message: String(sourceRun?.message ?? "").trim(),
                    startedAt: String(sourceRun?.startedAt ?? "").trim(),
                    finishedAt: String(sourceRun?.finishedAt ?? "").trim(),
                    durationMs: Math.max(0, Number(sourceRun?.durationMs) || 0),
                    metrics:
                      sourceRun?.metrics && typeof sourceRun.metrics === "object"
                        ? Object.fromEntries(
                            Object.entries(sourceRun.metrics).map(([key, value]) => [
                              String(key),
                              typeof value === "number" || typeof value === "boolean"
                                ? value
                                : String(value ?? ""),
                            ])
                          )
                        : {},
                  } satisfies StudyAbroadCatalogSyncSourceRun))
                  .filter((sourceRun) => sourceRun.label)
              : [],
            before: {
              universityCount: Math.max(0, Number(run?.before?.universityCount) || 0),
              programCount: Math.max(0, Number(run?.before?.programCount) || 0),
              countryCount: Math.max(0, Number(run?.before?.countryCount) || 0),
              tuitionCoverage: Math.max(0, Number(run?.before?.tuitionCoverage) || 0),
              admissionsCoverage: Math.max(0, Number(run?.before?.admissionsCoverage) || 0),
              structuredAdmissionsCoverage: Math.max(
                0,
                Number(run?.before?.structuredAdmissionsCoverage) || 0
              ),
            },
            after: {
              universityCount: Math.max(0, Number(run?.after?.universityCount) || 0),
              programCount: Math.max(0, Number(run?.after?.programCount) || 0),
              countryCount: Math.max(0, Number(run?.after?.countryCount) || 0),
              tuitionCoverage: Math.max(0, Number(run?.after?.tuitionCoverage) || 0),
              admissionsCoverage: Math.max(0, Number(run?.after?.admissionsCoverage) || 0),
              structuredAdmissionsCoverage: Math.max(
                0,
                Number(run?.after?.structuredAdmissionsCoverage) || 0
              ),
            },
            delta: {
              universityCount: Number(run?.delta?.universityCount) || 0,
              programCount: Number(run?.delta?.programCount) || 0,
              countryCount: Number(run?.delta?.countryCount) || 0,
              tuitionCoverage: Number(run?.delta?.tuitionCoverage) || 0,
              admissionsCoverage: Number(run?.delta?.admissionsCoverage) || 0,
              structuredAdmissionsCoverage:
                Number(run?.delta?.structuredAdmissionsCoverage) || 0,
            },
            message: String(run?.message ?? "").trim(),
          } satisfies StudyAbroadCatalogSyncRun))
          .filter((run) => run.runAt)
          .slice(0, 30)
      : [],
  } satisfies StudyAbroadCatalogSyncState;
}

async function writeStudyAbroadCatalogSyncState(state: StudyAbroadCatalogSyncState) {
  await mkdir(dirname(dataFilePath(CATALOG_SYNC_STATE_FILE)), { recursive: true });
  await writeFile(
    dataFilePath(CATALOG_SYNC_STATE_FILE),
    JSON.stringify(normalizeSyncState(state), null, 2),
    "utf8"
  );
}

export async function readStudyAbroadCatalogSyncState() {
  try {
    const raw = await readFile(dataFilePath(CATALOG_SYNC_STATE_FILE), "utf8");
    return normalizeSyncState(JSON.parse(raw));
  } catch {
    return DEFAULT_SYNC_STATE;
  }
}

async function recordStudyAbroadCatalogSyncRun(run: StudyAbroadCatalogSyncRun) {
  const current = await readStudyAbroadCatalogSyncState();
  const nextState = normalizeSyncState({
    updatedAt: run.runAt,
    runs: [run, ...current.runs].slice(0, 30),
  });
  await writeStudyAbroadCatalogSyncState(nextState);
  return nextState;
}

function buildCatalogSyncMessage(
  after: StudyAbroadCatalogSyncSnapshot,
  delta: StudyAbroadCatalogSyncRun["delta"],
  sourceRuns: StudyAbroadCatalogSyncSourceRun[]
) {
  const skipped = sourceRuns.filter((run) => run.metrics.skipped === true);
  const executedRuns = sourceRuns.filter((run) => run.metrics.skipped !== true);
  const okCount = executedRuns.filter((run) => run.ok).length;
  const failed = executedRuns.filter((run) => !run.ok);
  const successPart = `底库同步完成：成功 ${okCount}/${executedRuns.length} 个执行来源，当前共 ${after.universityCount} 所学校、${after.programCount} 个项目，覆盖 ${after.countryCount} 个国家 / 地区。`;
  const deltaPart = `本轮净增学校 ${delta.universityCount} 所、项目 ${delta.programCount} 个、国家 ${delta.countryCount} 个。`;
  const skippedPart = skipped.length
    ? ` 安全跳过：${skipped.map((item) => item.label).join(" / ")}。`
    : "";
  if (!failed.length) return `${successPart}${deltaPart}${skippedPart}`;
  return `${successPart}${deltaPart}${skippedPart} 失败来源：${failed.map((item) => item.label).join(" / ")}。`;
}

async function restoreAdmissionsSnapshotsFromCache() {
  const [programs, cachedInsights] = await Promise.all([
    readStudyAbroadCatalogPrograms(),
    readStudyAbroadCachedAdmissionsInsights(),
  ]);
  const cacheMap = new Map(cachedInsights.map((item) => [item.programId, item]));
  let restoredCount = 0;

  const nextPrograms = programs.map((program) => {
    if (program.admissionsSnapshot?.extractedAt) {
      return program;
    }

    const cached = cacheMap.get(program.id);
    if (!cached) {
      return program;
    }

    restoredCount += 1;
    return {
      ...program,
      admissionsSnapshot: {
        extractedAt: cached.fetchedAt || new Date().toISOString(),
        extractionStatus: cached.extractionStatus,
        gpaMin: cached.admissionsProfile.gpaMin,
        gpaScale: cached.admissionsProfile.gpaScale,
        ieltsMin: cached.admissionsProfile.ieltsMin,
        toeflMin: cached.admissionsProfile.toeflMin,
        duolingoMin: cached.admissionsProfile.duolingoMin,
        pteMin: cached.admissionsProfile.pteMin,
        greStatus: cached.admissionsProfile.greStatus,
        gmatStatus: cached.admissionsProfile.gmatStatus,
        workExperienceYears: cached.admissionsProfile.workExperienceYears,
      },
    };
  });

  if (!restoredCount) {
    return { restoredCount: 0 };
  }

  await writeStudyAbroadCatalogPrograms(nextPrograms);
  return { restoredCount };
}

export async function executeStudyAbroadCatalogSync(
  options: StudyAbroadCatalogSyncOptions = {}
) {
  const selection = resolveStudyAbroadCatalogSyncSelection(options);
  const mode = options.mode === "auto" ? "auto" : "manual";
  const trigger =
    options.trigger === "automation" || options.trigger === "script"
      ? options.trigger
      : "dashboard";
  const beforeSummary = await readStudyAbroadCatalogSummary();
  const before = toSnapshot(beforeSummary);

  const taskCandidates: Array<CatalogSyncTask | null> = [
    selection.includeGlobal
      ? {
          id: "global-universities" as const,
          label: "全球学校底库",
          run: () => syncGlobalStudyAbroadUniversityCatalog(),
        }
      : null,
    selection.includeUs
      ? {
          id: "us-pilot" as const,
          label: "美国试点底库",
          run: () =>
            syncUsStudyAbroadCatalog({
              maxPages: options.usMaxPages,
              perPage: options.usPerPage,
            }),
        }
      : null,
    selection.includeUk
      ? {
          id: "uk-pilot" as const,
          label: "英国硕士项目种子",
          run: () => syncUkStudyAbroadPilotPrograms(),
        }
      : null,
    selection.includeFocus
      ? {
          id: "focus-pilot" as const,
          label: "重点国家官方项目种子",
          run: () => syncFocusStudyAbroadPilotPrograms(),
        }
      : null,
  ];
  const tasks = taskCandidates.filter((task): task is CatalogSyncTask => task !== null);

  if (!tasks.length) {
    return {
      ok: false,
      message: "当前没有选中任何底库同步来源。",
      sourceRuns: [],
      before,
      after: before,
      delta: {
        universityCount: 0,
        programCount: 0,
        countryCount: 0,
        tuitionCoverage: 0,
        admissionsCoverage: 0,
        structuredAdmissionsCoverage: 0,
      },
    };
  }

  const sourceRuns: StudyAbroadCatalogSyncSourceRun[] = [];

  if (selection.skippedUsForDemoKey) {
    const now = new Date().toISOString();
    sourceRuns.push({
      id: "us-pilot",
      label: "美国试点底库",
      ok: true,
      message:
        "当前未配置正式 COLLEGE_SCORECARD_API_KEY，已安全跳过美国源，避免 demo key 在后台或自动同步里撞到限流。",
      startedAt: now,
      finishedAt: now,
      durationMs: 0,
      metrics: {
        skipped: true,
        reason: selection.scorecardMode,
      },
    });
  }

  for (const task of tasks) {
    const startedAt = new Date();
    try {
      const result = await task.run();
      const finishedAt = new Date();
      const resultMessage =
        result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
          ? result.message.trim()
          : "";
      sourceRuns.push({
        id: task.id,
        label: task.label,
        ok: true,
        message: resultMessage || `${task.label} 同步成功。`,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        metrics:
          result && typeof result === "object"
            ? Object.fromEntries(
                Object.entries(result).filter(([, value]) =>
                  ["string", "number", "boolean"].includes(typeof value)
                )
              )
            : {},
      });
    } catch (error) {
      const finishedAt = new Date();
      sourceRuns.push({
        id: task.id,
        label: task.label,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        metrics: {},
      });
    }
  }

  let afterSummary = await readStudyAbroadCatalogSummary();
  const restoreStartedAt = new Date();
  const restored = await restoreAdmissionsSnapshotsFromCache();
  if (restored.restoredCount > 0) {
    const restoreFinishedAt = new Date();
    sourceRuns.push({
      id: "cache-restore",
      label: "门槛缓存回填",
      ok: true,
      message: `已从本地 admissions cache 回填 ${restored.restoredCount} 个项目的门槛快照。`,
      startedAt: restoreStartedAt.toISOString(),
      finishedAt: restoreFinishedAt.toISOString(),
      durationMs: restoreFinishedAt.getTime() - restoreStartedAt.getTime(),
      metrics: {
        restoredCount: restored.restoredCount,
      },
    });
    afterSummary = await readStudyAbroadCatalogSummary();
  }
  const after = toSnapshot(afterSummary);
  const delta = {
    universityCount: after.universityCount - before.universityCount,
    programCount: after.programCount - before.programCount,
    countryCount: after.countryCount - before.countryCount,
    tuitionCoverage: after.tuitionCoverage - before.tuitionCoverage,
    admissionsCoverage: after.admissionsCoverage - before.admissionsCoverage,
    structuredAdmissionsCoverage:
      after.structuredAdmissionsCoverage - before.structuredAdmissionsCoverage,
  };
  const ok = sourceRuns.every((run) => run.ok);
  const runAt = new Date().toISOString();
  const run = {
    runAt,
    mode,
    trigger,
    ok,
    sourceRuns,
    before,
    after,
    delta,
    message: buildCatalogSyncMessage(after, delta, sourceRuns),
  } satisfies StudyAbroadCatalogSyncRun;

  await recordStudyAbroadCatalogSyncRun(run);

  return {
    ...run,
    ok,
  };
}
