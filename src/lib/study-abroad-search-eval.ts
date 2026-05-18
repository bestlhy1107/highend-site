import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { dataFilePath, readJsonArrayFile } from "./json-file-store";
import {
  searchStudyAbroadPrograms,
  type StudyAbroadResolvedQuery,
  type StudyAbroadSearchInput,
} from "./study-abroad-search";

export type StudyAbroadSearchEvalCase = {
  id: string;
  label: string;
  input: StudyAbroadSearchInput;
  expectations: {
    minVerifiedCount?: number;
    minUniversityCount?: number;
    minMeaningfulCount?: number;
    maxBlockedCount?: number;
    resolved?: Partial<
      Pick<StudyAbroadResolvedQuery, "country" | "degree" | "major" | "specialization">
    >;
  };
};

export type StudyAbroadSearchEvalCaseReport = {
  id: string;
  label: string;
  passed: boolean;
  reasons: string[];
  input: StudyAbroadSearchInput;
  expectations: StudyAbroadSearchEvalCase["expectations"];
  resolvedQuery: StudyAbroadResolvedQuery;
  metrics: {
    verifiedCount: number;
    universityCount: number;
    candidateCount: number;
    blockedCount: number;
    meaningfulCount: number;
  };
};

export type StudyAbroadSearchEvalReport = {
  generatedAt: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  zeroResultCases: number;
  lowResultCases: number;
  candidateHeavyCases: number;
  averageVerifiedCount: number;
  averageUniversityCount: number;
  averageCandidateCount: number;
  cases: StudyAbroadSearchEvalCaseReport[];
};

export type StudyAbroadSearchEvalHistoryItem = {
  generatedAt: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  passRate: number;
  zeroResultCases: number;
  lowResultCases: number;
  candidateHeavyCases: number;
  averageVerifiedCount: number;
  averageUniversityCount: number;
  averageCandidateCount: number;
};

const CASES_FILE = "study-abroad-search-eval-cases.json";
const REPORT_FILE = "study-abroad-search-eval-report.json";
const HISTORY_FILE = "study-abroad-search-eval-history.json";
const MAX_HISTORY_ITEMS = 20;

function normalizeText(value?: string) {
  return String(value || "").trim();
}

function normalizeEvalCase(input: Partial<StudyAbroadSearchEvalCase>): StudyAbroadSearchEvalCase {
  return {
    id: normalizeText(input.id),
    label: normalizeText(input.label),
    input: {
      searchSessionId: normalizeText(input.input?.searchSessionId),
      freeText: normalizeText(input.input?.freeText),
      country: normalizeText(input.input?.country),
      major: normalizeText(input.input?.major),
      specialization: normalizeText(input.input?.specialization),
      degree: normalizeText(input.input?.degree),
      budgetTier: normalizeText(input.input?.budgetTier),
      intake: normalizeText(input.input?.intake),
      gpaProfile: normalizeText(input.input?.gpaProfile),
      languageProfile: normalizeText(input.input?.languageProfile),
      fitMode: normalizeText(input.input?.fitMode),
      snapshotQuality: normalizeText(input.input?.snapshotQuality),
      universityId: normalizeText(input.input?.universityId),
    },
    expectations: {
      minVerifiedCount: Number(input.expectations?.minVerifiedCount) || 0,
      minUniversityCount: Number(input.expectations?.minUniversityCount) || 0,
      minMeaningfulCount: Number(input.expectations?.minMeaningfulCount) || 0,
      maxBlockedCount:
        typeof input.expectations?.maxBlockedCount === "number"
          ? input.expectations.maxBlockedCount
          : 0,
      resolved: {
        country: normalizeText(input.expectations?.resolved?.country),
        degree: normalizeText(input.expectations?.resolved?.degree),
        major: normalizeText(input.expectations?.resolved?.major),
        specialization: normalizeText(input.expectations?.resolved?.specialization),
      },
    },
  };
}

function isValidEvalCase(input: StudyAbroadSearchEvalCase) {
  return Boolean(input.id && input.label);
}

function normalizeEvalCaseReport(
  input: Partial<StudyAbroadSearchEvalCaseReport>
): StudyAbroadSearchEvalCaseReport {
  return {
    id: normalizeText(input.id),
    label: normalizeText(input.label),
    passed: Boolean(input.passed),
    reasons: Array.isArray(input.reasons)
      ? input.reasons.map((item) => normalizeText(String(item))).filter(Boolean)
      : [],
    input: normalizeEvalCase({ input: input.input, id: "tmp", label: "tmp", expectations: {} })
      .input,
    expectations: normalizeEvalCase({
      id: "tmp",
      label: "tmp",
      input: {},
      expectations: input.expectations,
    }).expectations,
    resolvedQuery: {
      freeText: normalizeText(input.resolvedQuery?.freeText),
      country: normalizeText(input.resolvedQuery?.country),
      major: normalizeText(input.resolvedQuery?.major),
      specialization: normalizeText(input.resolvedQuery?.specialization),
      degree: normalizeText(input.resolvedQuery?.degree),
      budgetTier: normalizeText(input.resolvedQuery?.budgetTier),
      intake: normalizeText(input.resolvedQuery?.intake),
      gpaProfile: normalizeText(input.resolvedQuery?.gpaProfile),
      languageProfile: normalizeText(input.resolvedQuery?.languageProfile),
      fitMode: normalizeText(input.resolvedQuery?.fitMode),
      snapshotQuality: normalizeText(input.resolvedQuery?.snapshotQuality),
      universityId: normalizeText(input.resolvedQuery?.universityId),
    },
    metrics: {
      verifiedCount: Number(input.metrics?.verifiedCount) || 0,
      universityCount: Number(input.metrics?.universityCount) || 0,
      candidateCount: Number(input.metrics?.candidateCount) || 0,
      blockedCount: Number(input.metrics?.blockedCount) || 0,
      meaningfulCount: Number(input.metrics?.meaningfulCount) || 0,
    },
  };
}

function normalizeEvalReport(input: Partial<StudyAbroadSearchEvalReport>): StudyAbroadSearchEvalReport {
  return {
    generatedAt: normalizeText(input.generatedAt) || new Date(0).toISOString(),
    totalCases: Number(input.totalCases) || 0,
    passedCases: Number(input.passedCases) || 0,
    failedCases: Number(input.failedCases) || 0,
    passRate: Number(input.passRate) || 0,
    zeroResultCases: Number(input.zeroResultCases) || 0,
    lowResultCases: Number(input.lowResultCases) || 0,
    candidateHeavyCases: Number(input.candidateHeavyCases) || 0,
    averageVerifiedCount: Number(input.averageVerifiedCount) || 0,
    averageUniversityCount: Number(input.averageUniversityCount) || 0,
    averageCandidateCount: Number(input.averageCandidateCount) || 0,
    cases: Array.isArray(input.cases)
      ? input.cases.map(normalizeEvalCaseReport).filter((item) => item.id && item.label)
      : [],
  };
}

function normalizeEvalHistoryItem(
  input: Partial<StudyAbroadSearchEvalHistoryItem>
): StudyAbroadSearchEvalHistoryItem {
  return {
    generatedAt: normalizeText(input.generatedAt) || new Date(0).toISOString(),
    totalCases: Number(input.totalCases) || 0,
    passedCases: Number(input.passedCases) || 0,
    failedCases: Number(input.failedCases) || 0,
    passRate: Number(input.passRate) || 0,
    zeroResultCases: Number(input.zeroResultCases) || 0,
    lowResultCases: Number(input.lowResultCases) || 0,
    candidateHeavyCases: Number(input.candidateHeavyCases) || 0,
    averageVerifiedCount: Number(input.averageVerifiedCount) || 0,
    averageUniversityCount: Number(input.averageUniversityCount) || 0,
    averageCandidateCount: Number(input.averageCandidateCount) || 0,
  };
}

function buildEvalHistoryItem(report: StudyAbroadSearchEvalReport): StudyAbroadSearchEvalHistoryItem {
  return normalizeEvalHistoryItem({
    generatedAt: report.generatedAt,
    totalCases: report.totalCases,
    passedCases: report.passedCases,
    failedCases: report.failedCases,
    passRate: report.passRate,
    zeroResultCases: report.zeroResultCases,
    lowResultCases: report.lowResultCases,
    candidateHeavyCases: report.candidateHeavyCases,
    averageVerifiedCount: report.averageVerifiedCount,
    averageUniversityCount: report.averageUniversityCount,
    averageCandidateCount: report.averageCandidateCount,
  });
}

export async function readStudyAbroadSearchEvalCases() {
  return readJsonArrayFile<StudyAbroadSearchEvalCase>({
    fileName: CASES_FILE,
    fallback: [],
    normalize: normalizeEvalCase,
    isValid: isValidEvalCase,
  });
}

export async function readStudyAbroadSearchEvalReport() {
  try {
    const raw = await readFile(dataFilePath(REPORT_FILE), "utf8");
    return normalizeEvalReport(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readStudyAbroadSearchEvalHistory() {
  return readJsonArrayFile<StudyAbroadSearchEvalHistoryItem>({
    fileName: HISTORY_FILE,
    fallback: [],
    normalize: normalizeEvalHistoryItem,
    isValid: (item) => Boolean(item.generatedAt),
  }).then((items) =>
    [...items].sort(
      (left, right) =>
        new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime()
    )
  );
}

export async function writeStudyAbroadSearchEvalReport(report: StudyAbroadSearchEvalReport) {
  await mkdir(dirname(dataFilePath(REPORT_FILE)), { recursive: true });
  await writeFile(
    dataFilePath(REPORT_FILE),
    JSON.stringify(normalizeEvalReport(report), null, 2),
    "utf8"
  );
}

export async function writeStudyAbroadSearchEvalHistory(
  items: StudyAbroadSearchEvalHistoryItem[]
) {
  await mkdir(dirname(dataFilePath(HISTORY_FILE)), { recursive: true });
  await writeFile(
    dataFilePath(HISTORY_FILE),
    JSON.stringify(
      items
        .map(normalizeEvalHistoryItem)
        .sort(
          (left, right) =>
            new Date(right.generatedAt).getTime() - new Date(left.generatedAt).getTime()
        )
        .slice(0, MAX_HISTORY_ITEMS),
      null,
      2
    ),
    "utf8"
  );
}

function buildExpectationReasons(
  expectations: StudyAbroadSearchEvalCase["expectations"],
  resolvedQuery: StudyAbroadResolvedQuery,
  metrics: StudyAbroadSearchEvalCaseReport["metrics"]
) {
  const reasons: string[] = [];

  if (expectations.minVerifiedCount && metrics.verifiedCount < expectations.minVerifiedCount) {
    reasons.push(
      `正式项目数量不足：预期至少 ${expectations.minVerifiedCount} 条，实际 ${metrics.verifiedCount} 条。`
    );
  }

  if (
    expectations.minUniversityCount &&
    metrics.universityCount < expectations.minUniversityCount
  ) {
    reasons.push(
      `学校池数量不足：预期至少 ${expectations.minUniversityCount} 所，实际 ${metrics.universityCount} 所。`
    );
  }

  if (
    expectations.minMeaningfulCount &&
    metrics.meaningfulCount < expectations.minMeaningfulCount
  ) {
    reasons.push(
      `总有效结果不足：预期至少 ${expectations.minMeaningfulCount} 条，实际 ${metrics.meaningfulCount} 条。`
    );
  }

  if (
    typeof expectations.maxBlockedCount === "number" &&
    metrics.blockedCount > expectations.maxBlockedCount
  ) {
    reasons.push(
      `规避命中过多：预期不超过 ${expectations.maxBlockedCount} 条，实际 ${metrics.blockedCount} 条。`
    );
  }

  const expectedResolved = expectations.resolved || {};
  const fields: Array<keyof typeof expectedResolved> = [
    "country",
    "degree",
    "major",
    "specialization",
  ];

  fields.forEach((field) => {
    const expectedValue = normalizeText(expectedResolved[field]);
    if (!expectedValue) {
      return;
    }

    const actualValue = normalizeText(resolvedQuery[field]);
    if (actualValue !== expectedValue) {
      reasons.push(`识别结果不符合预期：${field} 应为 ${expectedValue}，实际为 ${actualValue || "空"}`);
    }
  });

  return reasons;
}

export async function evaluateStudyAbroadSearchCases(options?: {
  caseId?: string;
  persistReport?: boolean;
}) {
  const caseId = normalizeText(options?.caseId);
  const persistReport = Boolean(options?.persistReport);
  const allCases = await readStudyAbroadSearchEvalCases();
  const cases = caseId ? allCases.filter((item) => item.id === caseId) : allCases;

  const reports: StudyAbroadSearchEvalCaseReport[] = [];

  for (const item of cases) {
    const result = await searchStudyAbroadPrograms(item.input);
    const metrics = {
      verifiedCount: result.displayedVerifiedCount,
      universityCount: result.totalUniversityCount,
      candidateCount: result.candidateResults.length,
      blockedCount: result.blockedResultCount,
      meaningfulCount: result.displayedVerifiedCount + result.candidateResults.length,
    };
    const reasons = buildExpectationReasons(item.expectations, result.resolvedQuery, metrics);

    reports.push(
      normalizeEvalCaseReport({
        id: item.id,
        label: item.label,
        passed: reasons.length === 0,
        reasons,
        input: item.input,
        expectations: item.expectations,
        resolvedQuery: result.resolvedQuery,
        metrics,
      })
    );
  }

  const totalCases = reports.length;
  const passedCases = reports.filter((item) => item.passed).length;
  const failedCases = totalCases - passedCases;
  const zeroResultCases = reports.filter((item) => item.metrics.meaningfulCount === 0).length;
  const lowResultCases = reports.filter(
    (item) => item.metrics.meaningfulCount > 0 && item.metrics.meaningfulCount <= 3
  ).length;
  const candidateHeavyCases = reports.filter(
    (item) => item.metrics.candidateCount > item.metrics.verifiedCount
  ).length;

  const report = normalizeEvalReport({
    generatedAt: new Date().toISOString(),
    totalCases,
    passedCases,
    failedCases,
    passRate: totalCases ? Number(((passedCases / totalCases) * 100).toFixed(1)) : 0,
    zeroResultCases,
    lowResultCases,
    candidateHeavyCases,
    averageVerifiedCount: totalCases
      ? Number(
          (
            reports.reduce((sum, item) => sum + item.metrics.verifiedCount, 0) / totalCases
          ).toFixed(1)
        )
      : 0,
    averageUniversityCount: totalCases
      ? Number(
          (
            reports.reduce((sum, item) => sum + item.metrics.universityCount, 0) / totalCases
          ).toFixed(1)
        )
      : 0,
    averageCandidateCount: totalCases
      ? Number(
          (
            reports.reduce((sum, item) => sum + item.metrics.candidateCount, 0) / totalCases
          ).toFixed(1)
        )
      : 0,
    cases: reports,
  });

  if (persistReport && !caseId) {
    await writeStudyAbroadSearchEvalReport(report);
    const history = await readStudyAbroadSearchEvalHistory();
    const nextHistory = [buildEvalHistoryItem(report), ...history].slice(0, MAX_HISTORY_ITEMS);
    await writeStudyAbroadSearchEvalHistory(nextHistory);
  }

  return report;
}
