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
  candidates: StudyAbroadReviewCandidate[];
};

const FILE_NAME = "study-abroad-review-queue.json";
const MAX_QUEUE_ITEMS = 200;
const MAX_CANDIDATES_PER_ENTRY = 8;

function normalizeCandidate(input: Partial<StudyAbroadReviewCandidate>): StudyAbroadReviewCandidate {
  return {
    title: String(input.title ?? "").trim(),
    link: String(input.link ?? "").trim(),
    displayLink: String(input.displayLink ?? "").trim(),
    snippet: String(input.snippet ?? "").trim(),
    provider: String(input.provider ?? "").trim(),
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

  return Array.from(map.values()).slice(0, MAX_CANDIDATES_PER_ENTRY);
}
