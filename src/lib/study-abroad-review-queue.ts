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
    .slice(0, 12);

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

  return Array.from(map.values()).slice(0, 12);
}
