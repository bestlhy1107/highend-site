import { randomUUID } from "node:crypto";
import {
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";

export type StudyAbroadReviewCandidate = {
  title: string;
  link: string;
  displayLink: string;
  snippet: string;
  provider: string;
  date?: string;
  authorityScore?: number;
  rerankScore?: number;
  score?: number;
  credibilityLevel?: "high" | "medium" | "watch";
  credibilityLabel?: string;
  credibilityReason?: string;
  relevanceSignals?: string[];
};

export type StudyAbroadReviewEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "reviewed" | "discarded";
  country: string;
  major: string;
  specialization: string;
  degree: string;
  adminNote: string;
  reviewHistory: StudyAbroadReviewHistoryItem[];
  candidates: StudyAbroadReviewCandidate[];
};

export type StudyAbroadReviewHistoryItem = {
  id: string;
  createdAt: string;
  action: string;
  note: string;
};

export type StudyAbroadReviewAvoidDomainSuggestion = {
  domain: string;
  label: string;
  link: string;
  count: number;
};

const FILE_NAME = "study-abroad-review-queue.json";
const MAX_QUEUE_ITEMS = 200;
const MAX_CANDIDATES_PER_ENTRY = 20;
const MAX_HISTORY_ITEMS = 24;

function normalizeCandidate(input: Partial<StudyAbroadReviewCandidate>): StudyAbroadReviewCandidate {
  return {
    title: String(input.title ?? "").trim(),
    link: String(input.link ?? "").trim(),
    displayLink: String(input.displayLink ?? "").trim(),
    snippet: String(input.snippet ?? "").trim(),
    provider: String(input.provider ?? "").trim(),
    date: String(input.date ?? "").trim() || undefined,
    authorityScore:
      typeof input.authorityScore === "number" && Number.isFinite(input.authorityScore)
        ? input.authorityScore
        : undefined,
    rerankScore:
      typeof input.rerankScore === "number" && Number.isFinite(input.rerankScore)
        ? input.rerankScore
        : undefined,
    score:
      typeof input.score === "number" && Number.isFinite(input.score)
        ? input.score
        : undefined,
    credibilityLevel:
      input.credibilityLevel === "high" ||
      input.credibilityLevel === "medium" ||
      input.credibilityLevel === "watch"
        ? input.credibilityLevel
        : "watch",
    credibilityLabel: String(input.credibilityLabel ?? "").trim() || "待核对",
    credibilityReason:
      String(input.credibilityReason ?? "").trim() || "来源和内容需要后台继续核对后再导入正式项目。",
    relevanceSignals: Array.isArray(input.relevanceSignals)
      ? input.relevanceSignals
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
          .slice(0, 4)
      : [],
  };
}

function isValidCandidate(candidate: StudyAbroadReviewCandidate) {
  return Boolean(candidate.title && candidate.link && candidate.provider);
}

function normalizeEntry(input: Partial<StudyAbroadReviewEntry>): StudyAbroadReviewEntry {
  return {
    id: String(input.id ?? randomUUID()),
    createdAt: String(input.createdAt ?? new Date().toISOString()),
    updatedAt: String(input.updatedAt ?? new Date().toISOString()),
    status:
      input.status === "reviewed" || input.status === "discarded"
        ? input.status
        : "pending",
    country: String(input.country ?? "").trim(),
    major: String(input.major ?? "").trim(),
    specialization: String(input.specialization ?? "").trim(),
    degree: String(input.degree ?? "").trim(),
    adminNote: String(input.adminNote ?? "").trim(),
    reviewHistory: Array.isArray(input.reviewHistory)
      ? input.reviewHistory
          .map(normalizeReviewHistoryItem)
          .filter(isValidReviewHistoryItem)
          .slice(0, MAX_HISTORY_ITEMS)
      : [],
    candidates: Array.isArray(input.candidates)
      ? input.candidates.map(normalizeCandidate).filter(isValidCandidate)
      : [],
  };
}

function isValidEntry(entry: StudyAbroadReviewEntry) {
  return Boolean(entry.id && entry.status && entry.candidates.length);
}

function compareByUpdatedAt(a: StudyAbroadReviewEntry, b: StudyAbroadReviewEntry) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function normalizeReviewHistoryItem(
  input: Partial<StudyAbroadReviewHistoryItem>
): StudyAbroadReviewHistoryItem {
  return {
    id: String(input.id ?? randomUUID()),
    createdAt: String(input.createdAt ?? new Date().toISOString()),
    action: String(input.action ?? "").trim(),
    note: String(input.note ?? "").trim(),
  };
}

function isValidReviewHistoryItem(item: StudyAbroadReviewHistoryItem) {
  return Boolean(item.id && item.createdAt && item.action);
}

function appendHistory(
  current: StudyAbroadReviewHistoryItem[],
  input: {
    action: string;
    note?: string;
    createdAt?: string;
  }
) {
  const nextItem = normalizeReviewHistoryItem({
    createdAt: input.createdAt,
    action: input.action,
    note: input.note,
  });

  return [nextItem, ...current]
    .map(normalizeReviewHistoryItem)
    .filter(isValidReviewHistoryItem)
    .slice(0, MAX_HISTORY_ITEMS);
}

function extractCandidateDomain(value?: string) {
  try {
    return new URL(String(value || "").trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function looksLikeAcademicDomain(domain: string) {
  return (
    domain.includes(".edu") ||
    domain.includes(".ac.") ||
    domain.endsWith(".edu.cn") ||
    domain.endsWith(".edu.hk") ||
    domain.endsWith(".edu.sg") ||
    domain.endsWith(".edu.au") ||
    domain.endsWith(".ac.uk") ||
    domain.endsWith(".ac.jp")
  );
}

function matchesAvoidCredibilityMode(
  value: StudyAbroadReviewCandidate["credibilityLevel"],
  mode: "watch" | "watch-medium" | "all"
) {
  if (mode === "all") return true;
  if (mode === "watch-medium") return value === "watch" || value === "medium";
  return value === "watch" || !value;
}

export async function readStudyAbroadReviewQueue() {
  return readJsonArrayFile<StudyAbroadReviewEntry>({
    fileName: FILE_NAME,
    fallback: [],
    normalize: normalizeEntry,
    isValid: isValidEntry,
    compare: compareByUpdatedAt,
  });
}

export async function updateStudyAbroadReviewEntryStatus(params: {
  id: string;
  status: "reviewed" | "discarded";
  note?: string;
}) {
  const id = String(params.id ?? "").trim();
  const status = params.status;

  if (!id || (status !== "reviewed" && status !== "discarded")) {
    return {
      ok: false,
      updated: false,
      entry: null,
      message: "缺少可更新的候选任务。",
    };
  }

  const queue = await readStudyAbroadReviewQueue();
  const target = queue.find((item) => item.id === id);

  if (!target) {
    return {
      ok: false,
      updated: false,
      entry: null,
      message: "这条候选任务不存在，可能已经被处理。",
    };
  }

  if (target.status === status) {
    return {
      ok: true,
      updated: false,
      entry: target,
      message:
        status === "reviewed"
          ? "这组候选已经标记为已入库。"
          : "这组候选已经标记为已丢弃。",
    };
  }

  const now = new Date().toISOString();
  const nextQueue = queue.map((item) =>
    item.id === id
      ? normalizeEntry({
          ...item,
          status,
          updatedAt: now,
          adminNote: String(params.note ?? "").trim() || item.adminNote,
          reviewHistory: appendHistory(item.reviewHistory, {
            action: status === "reviewed" ? "整组标记已入库" : "整组标记已丢弃",
            note: String(params.note ?? "").trim(),
            createdAt: now,
          }),
        })
      : item
  );
  const updatedEntry = nextQueue.find((item) => item.id === id) ?? null;

  await writeJsonArrayFile(nextQueue, {
    fileName: FILE_NAME,
    normalize: normalizeEntry,
    isValid: isValidEntry,
    compare: compareByUpdatedAt,
  });

  return {
    ok: true,
    updated: true,
    entry: updatedEntry,
    message:
      status === "reviewed"
        ? "这组候选已标记为已入库，不会继续停留在待核验列表。"
        : "这组候选已标记为已丢弃，不会继续停留在待核验列表。",
  };
}

export async function updateStudyAbroadReviewEntryNote(input: {
  id: string;
  note: string;
}) {
  const id = String(input.id ?? "").trim();
  const note = String(input.note ?? "").trim();

  if (!id) {
    return {
      ok: false,
      updated: false,
      entry: null,
      message: "缺少候选任务 ID。",
    };
  }

  const queue = await readStudyAbroadReviewQueue();
  const target = queue.find((item) => item.id === id);

  if (!target) {
    return {
      ok: false,
      updated: false,
      entry: null,
      message: "这条候选任务不存在，暂时无法保存备注。",
    };
  }

  const unchanged = note === target.adminNote;
  if (unchanged) {
    return {
      ok: true,
      updated: false,
      entry: target,
      message: "备注内容没有变化。",
    };
  }

  const now = new Date().toISOString();
  const nextQueue = queue.map((item) =>
    item.id === id
      ? normalizeEntry({
          ...item,
          updatedAt: now,
          adminNote: note,
          reviewHistory: appendHistory(item.reviewHistory, {
            action: note ? "更新审核备注" : "清空审核备注",
            note,
            createdAt: now,
          }),
        })
      : item
  );
  const updatedEntry = nextQueue.find((item) => item.id === id) ?? null;

  await writeJsonArrayFile(nextQueue, {
    fileName: FILE_NAME,
    normalize: normalizeEntry,
    isValid: isValidEntry,
    compare: compareByUpdatedAt,
  });

  return {
    ok: true,
    updated: true,
    entry: updatedEntry,
    message: note ? "审核备注已保存。" : "审核备注已清空。",
  };
}

export async function appendStudyAbroadReviewEntryHistory(input: {
  id: string;
  action: string;
  note?: string;
}) {
  const id = String(input.id ?? "").trim();
  const action = String(input.action ?? "").trim();
  const note = String(input.note ?? "").trim();

  if (!id || !action) {
    return {
      ok: false,
      updated: false,
      entry: null,
      message: "缺少可记录的审核历史。",
    };
  }

  const queue = await readStudyAbroadReviewQueue();
  const target = queue.find((item) => item.id === id);

  if (!target) {
    return {
      ok: false,
      updated: false,
      entry: null,
      message: "这条候选任务不存在，无法记录审核历史。",
    };
  }

  const now = new Date().toISOString();
  const nextQueue = queue.map((item) =>
    item.id === id
      ? normalizeEntry({
          ...item,
          updatedAt: now,
          reviewHistory: appendHistory(item.reviewHistory, {
            action,
            note,
            createdAt: now,
          }),
        })
      : item
  );
  const updatedEntry = nextQueue.find((item) => item.id === id) ?? null;

  await writeJsonArrayFile(nextQueue, {
    fileName: FILE_NAME,
    normalize: normalizeEntry,
    isValid: isValidEntry,
    compare: compareByUpdatedAt,
  });

  return {
    ok: true,
    updated: true,
    entry: updatedEntry,
    message: "审核历史已记录。",
  };
}

export async function enqueueStudyAbroadReview(params: {
  country?: string;
  major?: string;
  specialization?: string;
  degree?: string;
  candidates: StudyAbroadReviewCandidate[];
}) {
  const normalizedCandidates = params.candidates
    .map(normalizeCandidate)
    .filter(isValidCandidate)
    .slice(0, MAX_CANDIDATES_PER_ENTRY);

  if (!normalizedCandidates.length) {
    return { saved: false, queueSize: 0 };
  }

  const queue = await readStudyAbroadReviewQueue();
  const now = new Date().toISOString();
  const country = String(params.country ?? "").trim();
  const major = String(params.major ?? "").trim();
  const specialization = String(params.specialization ?? "").trim();
  const degree = String(params.degree ?? "").trim();

  const existing = queue.find(
    (item) =>
      item.status === "pending" &&
      item.country === country &&
      item.major === major &&
      item.specialization === specialization &&
      item.degree === degree
  );

  if (existing) {
    const mergedCandidates = mergeCandidates(existing.candidates, normalizedCandidates);
    const unchanged =
      mergedCandidates.length === existing.candidates.length &&
      mergedCandidates.every((candidate, index) => candidate.link === existing.candidates[index]?.link);

    if (unchanged) {
      return { saved: false, queueSize: queue.length };
    }
  }

  const next = existing
    ? queue.map((item) =>
        item.id === existing.id
          ? normalizeEntry({
              ...item,
              updatedAt: now,
              candidates: mergeCandidates(item.candidates, normalizedCandidates),
            })
          : item
      )
    : [
        normalizeEntry({
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          status: "pending",
          country,
          major,
          specialization,
          degree,
          adminNote: "",
          reviewHistory: [],
          candidates: normalizedCandidates,
        }),
        ...queue,
      ];

  const trimmed = next.slice(0, MAX_QUEUE_ITEMS);

  await writeJsonArrayFile(trimmed, {
    fileName: FILE_NAME,
    normalize: normalizeEntry,
    isValid: isValidEntry,
    compare: compareByUpdatedAt,
  });

  return { saved: true, queueSize: trimmed.length };
}

function mergeCandidates(
  current: StudyAbroadReviewCandidate[],
  incoming: StudyAbroadReviewCandidate[]
) {
  const map = new Map<string, StudyAbroadReviewCandidate>();

  [...current, ...incoming].forEach((candidate) => {
    if (!candidate.link) return;
    map.set(candidate.link, candidate);
  });

  return Array.from(map.values())
    .sort(compareCandidatesForReview)
    .slice(0, MAX_CANDIDATES_PER_ENTRY);
}

function compareCandidatesForReview(a: StudyAbroadReviewCandidate, b: StudyAbroadReviewCandidate) {
  return (
    credibilityPriority(b.credibilityLevel) - credibilityPriority(a.credibilityLevel) ||
    Number(b.score ?? 0) - Number(a.score ?? 0) ||
    Number(b.authorityScore ?? 0) - Number(a.authorityScore ?? 0) ||
    Number(b.rerankScore ?? 0) - Number(a.rerankScore ?? 0) ||
    a.title.localeCompare(b.title, "zh-CN")
  );
}

function credibilityPriority(value?: StudyAbroadReviewCandidate["credibilityLevel"]) {
  switch (value) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

export function collectStudyAbroadReviewAvoidDomainSuggestions(
  entry: Pick<StudyAbroadReviewEntry, "candidates">,
  options?: {
    credibilityMode?: "watch" | "watch-medium" | "all";
    minOccurrences?: number;
    blockedDomains?: Set<string>;
  }
) {
  const credibilityMode = options?.credibilityMode || "watch";
  const minOccurrences = Math.max(1, Number(options?.minOccurrences) || 2);
  const blockedDomains = options?.blockedDomains || new Set<string>();
  const domainMap = new Map<string, StudyAbroadReviewAvoidDomainSuggestion>();

  entry.candidates.forEach((candidate) => {
    if (!matchesAvoidCredibilityMode(candidate.credibilityLevel, credibilityMode)) {
      return;
    }

    const domain = extractCandidateDomain(candidate.link || candidate.displayLink);
    if (!domain || blockedDomains.has(domain) || looksLikeAcademicDomain(domain)) {
      return;
    }

    const current = domainMap.get(domain);
    if (current) {
      current.count += 1;
      return;
    }

    domainMap.set(domain, {
      domain,
      label: candidate.displayLink || candidate.provider || candidate.title || domain,
      link: candidate.link,
      count: 1,
    });
  });

  return Array.from(domainMap.values())
    .filter((item) => item.count >= minOccurrences)
    .sort((left, right) => right.count - left.count || left.domain.localeCompare(right.domain));
}
