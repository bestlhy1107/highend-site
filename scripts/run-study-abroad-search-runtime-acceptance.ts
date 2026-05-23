import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  expandStudyAbroadSearchCandidates,
  getStudyAbroadSearchRuntimeStatus,
  searchStudyAbroadPrograms,
  type StudyAbroadSearchInput,
  type StudyAbroadResolvedQuery,
} from "../src/lib/study-abroad-search";
import {
  readStudyAbroadSearchAuditEntries,
  type StudyAbroadSearchAuditEntry,
} from "../src/lib/study-abroad-search-governance";
import {
  collectStudyAbroadReviewAvoidDomainSuggestions,
  readStudyAbroadReviewQueue,
  type StudyAbroadReviewCandidate,
  type StudyAbroadReviewEntry,
} from "../src/lib/study-abroad-review-queue";

type RuntimeAcceptanceCase = {
  id: string;
  label: string;
  input: StudyAbroadSearchInput;
  minCandidateCount?: number;
  minPendingReviewCount?: number;
  minHighCredibilityCount?: number;
  notes?: string;
};

type RuntimeAcceptanceCaseReport = {
  id: string;
  label: string;
  ok: boolean;
  notes: string;
  sessionId: string;
  resolvedQuery: StudyAbroadResolvedQuery;
  verifiedCount: number;
  universityCount: number;
  candidateCount: number;
  pendingReviewCount: number;
  blockedResultCount: number;
  highCredibilityCount: number;
  mediumCredibilityCount: number;
  watchCredibilityCount: number;
  auditEntryFound: boolean;
  auditCandidateCount: number;
  pendingQueueEntryId: string;
  pendingQueueEntryStatus: string;
  pendingQueueCandidateCount: number;
  avoidSuggestionWatchCount: number;
  avoidSuggestionWatchMediumCount: number;
  failures: string[];
};

type RuntimeAcceptanceReport = {
  generatedAt: string;
  runtime: ReturnType<typeof getStudyAbroadSearchRuntimeStatus>;
  strictMode: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skipped: boolean;
  summary: string;
  cases: RuntimeAcceptanceCaseReport[];
};

const CASE_FILE = resolve(
  process.cwd(),
  "data/study-abroad-search-runtime-acceptance-cases.json"
);
const REPORT_FILE = resolve(
  process.cwd(),
  "data/study-abroad-search-runtime-acceptance-report.json"
);

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
}

function normalizeCases(input: unknown): RuntimeAcceptanceCase[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const row = item as Partial<RuntimeAcceptanceCase>;
      return {
        id: String(row.id ?? "").trim(),
        label: String(row.label ?? "").trim(),
        input: row.input ?? {},
        minCandidateCount: Math.max(0, Number(row.minCandidateCount) || 0),
        minPendingReviewCount: Math.max(0, Number(row.minPendingReviewCount) || 0),
        minHighCredibilityCount: Math.max(0, Number(row.minHighCredibilityCount) || 0),
        notes: String(row.notes ?? "").trim(),
      } satisfies RuntimeAcceptanceCase;
    })
    .filter((item) => item.id && item.label);
}

async function readAcceptanceCases() {
  const raw = await readFile(CASE_FILE, "utf8");
  return normalizeCases(JSON.parse(raw));
}

function summarizeCredibility(candidates: StudyAbroadReviewCandidate[]) {
  return candidates.reduce(
    (acc, candidate) => {
      const level = candidate.credibilityLevel || "watch";
      if (level === "high") acc.high += 1;
      else if (level === "medium") acc.medium += 1;
      else acc.watch += 1;
      return acc;
    },
    { high: 0, medium: 0, watch: 0 }
  );
}

function matchQueueEntry(
  queue: StudyAbroadReviewEntry[],
  query: StudyAbroadResolvedQuery
) {
  return queue
    .filter(
      (item) =>
        item.country === query.country &&
        item.major === query.major &&
        item.specialization === query.specialization &&
        item.degree === query.degree
    )
    .sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    )[0];
}

function matchAuditEntry(
  entries: StudyAbroadSearchAuditEntry[],
  sessionId: string
) {
  return entries.find((item) => item.sessionId === sessionId);
}

function buildSkippedReport(
  runtime: ReturnType<typeof getStudyAbroadSearchRuntimeStatus>,
  strictMode: boolean
): RuntimeAcceptanceReport {
  return {
    generatedAt: new Date().toISOString(),
    runtime,
    strictMode,
    totalCases: 0,
    passedCases: 0,
    failedCases: 0,
    skipped: true,
    summary: runtime.apiKeyPresent
      ? "运行时还没有启用全网扩搜，已跳过线上验收。"
      : "运行时还没有检测到全网扩搜密钥，已跳过线上验收。",
    cases: [],
  };
}

async function writeReport(report: RuntimeAcceptanceReport) {
  await writeFile(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function runCase(item: RuntimeAcceptanceCase): Promise<RuntimeAcceptanceCaseReport> {
  const sessionId = randomUUID();
  const searchResult = await searchStudyAbroadPrograms(
    {
      ...item.input,
      searchSessionId: sessionId,
    },
    {
      includeExternalCandidates: false,
    }
  );
  const expansionResult = await expandStudyAbroadSearchCandidates({
    ...item.input,
    searchSessionId: sessionId,
  });
  const [auditEntries, queue] = await Promise.all([
    readStudyAbroadSearchAuditEntries(),
    readStudyAbroadReviewQueue(),
  ]);
  const auditEntry = matchAuditEntry(auditEntries, sessionId);
  const queueEntry = matchQueueEntry(queue, expansionResult.resolvedQuery);
  const credibilitySummary = summarizeCredibility(expansionResult.candidateResults);
  const avoidWatchSuggestions = queueEntry
    ? collectStudyAbroadReviewAvoidDomainSuggestions(queueEntry, {
        credibilityMode: "watch",
        minOccurrences: 2,
      })
    : [];
  const avoidWatchMediumSuggestions = queueEntry
    ? collectStudyAbroadReviewAvoidDomainSuggestions(queueEntry, {
        credibilityMode: "watch-medium",
        minOccurrences: 2,
      })
    : [];

  const failures: string[] = [];
  if (!expansionResult.expansionEnabled) {
    failures.push("运行时没有启用全网扩搜。");
  }
  if (!expansionResult.expansionAttempted) {
    failures.push("本轮查询没有真正触发扩搜。");
  }
  if (expansionResult.candidateResults.length < (item.minCandidateCount || 0)) {
    failures.push(
      `候选量不足，预期至少 ${item.minCandidateCount} 条，实际 ${expansionResult.candidateResults.length} 条。`
    );
  }
  const effectivePendingReviewCount = Math.max(
    expansionResult.pendingReviewCount,
    queueEntry?.candidates.length || 0
  );
  if (effectivePendingReviewCount < (item.minPendingReviewCount || 0)) {
    failures.push(
      `待审核承接量不足，预期至少 ${item.minPendingReviewCount} 条，实际新增 ${expansionResult.pendingReviewCount} 条，当前队列 ${queueEntry?.candidates.length || 0} 条。`
    );
  }
  if (credibilitySummary.high < (item.minHighCredibilityCount || 0)) {
    failures.push(
      `高可信候选不足，预期至少 ${item.minHighCredibilityCount} 条，实际 ${credibilitySummary.high} 条。`
    );
  }
  if (!auditEntry) {
    failures.push("没有找到对应的搜索留痕。");
  }
  if (!queueEntry) {
    failures.push("没有找到对应的待审核候选任务。");
  }

  return {
    id: item.id,
    label: item.label,
    ok: failures.length === 0,
    notes: item.notes || "",
    sessionId,
    resolvedQuery: expansionResult.resolvedQuery,
    verifiedCount: searchResult.displayedVerifiedCount,
    universityCount: searchResult.totalUniversityCount,
    candidateCount: expansionResult.candidateResults.length,
    pendingReviewCount: expansionResult.pendingReviewCount,
    blockedResultCount: expansionResult.blockedResultCount,
    highCredibilityCount: credibilitySummary.high,
    mediumCredibilityCount: credibilitySummary.medium,
    watchCredibilityCount: credibilitySummary.watch,
    auditEntryFound: Boolean(auditEntry),
    auditCandidateCount: auditEntry?.candidateCount || 0,
    pendingQueueEntryId: queueEntry?.id || "",
    pendingQueueEntryStatus: queueEntry?.status || "",
    pendingQueueCandidateCount: queueEntry?.candidates.length || 0,
    avoidSuggestionWatchCount: avoidWatchSuggestions.length,
    avoidSuggestionWatchMediumCount: avoidWatchMediumSuggestions.length,
    failures,
  };
}

async function main() {
  const strictMode = hasFlag("strict");
  const caseFilter = readArg("case")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const runtime = getStudyAbroadSearchRuntimeStatus();

  if (!runtime.externalSearchEnabled || !runtime.apiKeyPresent) {
    const report = buildSkippedReport(runtime, strictMode);
    await writeReport(report);
    console.log(JSON.stringify(report, null, 2));
    if (strictMode) {
      process.exitCode = 1;
    }
    return;
  }

  const cases = (await readAcceptanceCases()).filter((item) =>
    caseFilter.length ? caseFilter.includes(item.id) : true
  );
  const caseReports: RuntimeAcceptanceCaseReport[] = [];
  for (const item of cases) {
    caseReports.push(await runCase(item));
  }

  const passedCases = caseReports.filter((item) => item.ok).length;
  const failedCases = caseReports.length - passedCases;
  const report: RuntimeAcceptanceReport = {
    generatedAt: new Date().toISOString(),
    runtime,
    strictMode,
    totalCases: caseReports.length,
    passedCases,
    failedCases,
    skipped: false,
    summary:
      failedCases === 0
        ? `线上扩搜验收通过，共 ${passedCases}/${caseReports.length} 条样例通过。`
        : `线上扩搜验收存在失败样例，共 ${failedCases}/${caseReports.length} 条未通过。`,
    cases: caseReports,
  };

  await writeReport(report);
  console.log(JSON.stringify(report, null, 2));

  if (strictMode && failedCases > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[study-abroad-runtime-acceptance] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
