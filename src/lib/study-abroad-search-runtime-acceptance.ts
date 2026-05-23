import { readFile } from "node:fs/promises";
import { dataFilePath } from "./json-file-store";
import type { StudyAbroadResolvedQuery } from "./study-abroad-search";

export type StudyAbroadSearchRuntimeAcceptanceCaseReport = {
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

export type StudyAbroadSearchRuntimeAcceptanceReport = {
  generatedAt: string;
  runtime: {
    externalSearchEnabled: boolean;
    provider: string;
    model: string;
    apiKeyPresent: boolean;
    timeoutMs: number;
    maxCandidateResults: number;
    maxReviewQueueCandidates: number;
  };
  strictMode: boolean;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skipped: boolean;
  summary: string;
  cases: StudyAbroadSearchRuntimeAcceptanceCaseReport[];
};

const REPORT_FILE = "study-abroad-search-runtime-acceptance-report.json";

function normalizeText(value?: unknown) {
  return String(value ?? "").trim();
}

function normalizeQuery(input?: Partial<StudyAbroadResolvedQuery>): StudyAbroadResolvedQuery {
  return {
    freeText: normalizeText(input?.freeText),
    country: normalizeText(input?.country),
    major: normalizeText(input?.major),
    specialization: normalizeText(input?.specialization),
    degree: normalizeText(input?.degree),
    budgetTier: normalizeText(input?.budgetTier),
    intake: normalizeText(input?.intake),
    gpaProfile: normalizeText(input?.gpaProfile),
    languageProfile: normalizeText(input?.languageProfile),
    fitMode: normalizeText(input?.fitMode),
    snapshotQuality: normalizeText(input?.snapshotQuality),
    universityId: normalizeText(input?.universityId),
  };
}

function normalizeCaseReport(input: Partial<StudyAbroadSearchRuntimeAcceptanceCaseReport>) {
  return {
    id: normalizeText(input.id),
    label: normalizeText(input.label),
    ok: input.ok === true,
    notes: normalizeText(input.notes),
    sessionId: normalizeText(input.sessionId),
    resolvedQuery: normalizeQuery(input.resolvedQuery),
    verifiedCount: Math.max(0, Number(input.verifiedCount) || 0),
    universityCount: Math.max(0, Number(input.universityCount) || 0),
    candidateCount: Math.max(0, Number(input.candidateCount) || 0),
    pendingReviewCount: Math.max(0, Number(input.pendingReviewCount) || 0),
    blockedResultCount: Math.max(0, Number(input.blockedResultCount) || 0),
    highCredibilityCount: Math.max(0, Number(input.highCredibilityCount) || 0),
    mediumCredibilityCount: Math.max(0, Number(input.mediumCredibilityCount) || 0),
    watchCredibilityCount: Math.max(0, Number(input.watchCredibilityCount) || 0),
    auditEntryFound: input.auditEntryFound === true,
    auditCandidateCount: Math.max(0, Number(input.auditCandidateCount) || 0),
    pendingQueueEntryId: normalizeText(input.pendingQueueEntryId),
    pendingQueueEntryStatus: normalizeText(input.pendingQueueEntryStatus),
    pendingQueueCandidateCount: Math.max(0, Number(input.pendingQueueCandidateCount) || 0),
    avoidSuggestionWatchCount: Math.max(0, Number(input.avoidSuggestionWatchCount) || 0),
    avoidSuggestionWatchMediumCount: Math.max(0, Number(input.avoidSuggestionWatchMediumCount) || 0),
    failures: Array.isArray(input.failures)
      ? input.failures.map((item) => normalizeText(item)).filter(Boolean)
      : [],
  } satisfies StudyAbroadSearchRuntimeAcceptanceCaseReport;
}

function normalizeReport(input: Partial<StudyAbroadSearchRuntimeAcceptanceReport>) {
  const cases = Array.isArray(input.cases)
    ? input.cases.map(normalizeCaseReport).filter((item) => item.id && item.label)
    : [];

  return {
    generatedAt: normalizeText(input.generatedAt),
    runtime: {
      externalSearchEnabled: input.runtime?.externalSearchEnabled === true,
      provider: normalizeText(input.runtime?.provider),
      model: normalizeText(input.runtime?.model),
      apiKeyPresent: input.runtime?.apiKeyPresent === true,
      timeoutMs: Math.max(0, Number(input.runtime?.timeoutMs) || 0),
      maxCandidateResults: Math.max(0, Number(input.runtime?.maxCandidateResults) || 0),
      maxReviewQueueCandidates: Math.max(0, Number(input.runtime?.maxReviewQueueCandidates) || 0),
    },
    strictMode: input.strictMode === true,
    totalCases: Math.max(0, Number(input.totalCases) || cases.length),
    passedCases: Math.max(0, Number(input.passedCases) || cases.filter((item) => item.ok).length),
    failedCases: Math.max(0, Number(input.failedCases) || cases.filter((item) => !item.ok).length),
    skipped: input.skipped === true,
    summary: normalizeText(input.summary),
    cases,
  } satisfies StudyAbroadSearchRuntimeAcceptanceReport;
}

export async function readStudyAbroadSearchRuntimeAcceptanceReport() {
  try {
    const raw = await readFile(dataFilePath(REPORT_FILE), "utf8");
    const parsed = JSON.parse(raw);
    return normalizeReport(parsed);
  } catch {
    return null;
  }
}
