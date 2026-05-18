import {
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";

export type StudyAbroadSearchExecutionPlanStatus =
  | "pending"
  | "in_progress"
  | "completed";

export type StudyAbroadSearchExecutionPlanRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  label: string;
  status: StudyAbroadSearchExecutionPlanStatus;
  lastActionAt: string;
  lastActionSummary: string;
  completedAt: string;
  query: {
    country: string;
    degree: string;
    major: string;
    specialization: string;
  };
};

const EXECUTION_PLAN_FILE = "study-abroad-search-execution-plan-statuses.json";

function normalizeText(value?: string) {
  return String(value || "").trim();
}

export function buildStudyAbroadSearchExecutionPlanId(input?: {
  country?: string;
  degree?: string;
  major?: string;
  specialization?: string;
}) {
  return [
    normalizeText(input?.country).toLowerCase(),
    normalizeText(input?.degree).toLowerCase(),
    normalizeText(input?.major).toLowerCase(),
    normalizeText(input?.specialization).toLowerCase(),
  ]
    .filter(Boolean)
    .join("|");
}

function normalizeExecutionPlanRecord(
  input: Partial<StudyAbroadSearchExecutionPlanRecord>
): StudyAbroadSearchExecutionPlanRecord {
  return {
    id:
      normalizeText(input.id) ||
      buildStudyAbroadSearchExecutionPlanId(input.query) ||
      crypto.randomUUID(),
    createdAt: normalizeText(input.createdAt) || new Date().toISOString(),
    updatedAt: normalizeText(input.updatedAt) || new Date().toISOString(),
    label: normalizeText(input.label),
    status:
      input.status === "in_progress" || input.status === "completed"
        ? input.status
        : "pending",
    lastActionAt: normalizeText(input.lastActionAt),
    lastActionSummary: normalizeText(input.lastActionSummary),
    completedAt: normalizeText(input.completedAt),
    query: {
      country: normalizeText(input.query?.country),
      degree: normalizeText(input.query?.degree),
      major: normalizeText(input.query?.major),
      specialization: normalizeText(input.query?.specialization),
    },
  };
}

function isValidExecutionPlanRecord(record: StudyAbroadSearchExecutionPlanRecord) {
  return Boolean(record.id && record.label);
}

function compareExecutionPlanRecord(
  left: StudyAbroadSearchExecutionPlanRecord,
  right: StudyAbroadSearchExecutionPlanRecord
) {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

export async function readStudyAbroadSearchExecutionPlanRecords() {
  return readJsonArrayFile<StudyAbroadSearchExecutionPlanRecord>({
    fileName: EXECUTION_PLAN_FILE,
    fallback: [],
    normalize: normalizeExecutionPlanRecord,
    isValid: isValidExecutionPlanRecord,
    compare: compareExecutionPlanRecord,
  });
}

async function writeStudyAbroadSearchExecutionPlanRecords(
  items: StudyAbroadSearchExecutionPlanRecord[]
) {
  return writeJsonArrayFile(items, {
    fileName: EXECUTION_PLAN_FILE,
    normalize: normalizeExecutionPlanRecord,
    isValid: isValidExecutionPlanRecord,
    compare: compareExecutionPlanRecord,
  });
}

export async function updateStudyAbroadSearchExecutionPlanStatus(input: {
  id?: string;
  label?: string;
  status: StudyAbroadSearchExecutionPlanStatus;
  country?: string;
  degree?: string;
  major?: string;
  specialization?: string;
  actionSummary?: string;
  actionAt?: string;
}) {
  const records = await readStudyAbroadSearchExecutionPlanRecords();
  const id =
    normalizeText(input.id) ||
    buildStudyAbroadSearchExecutionPlanId(input) ||
    crypto.randomUUID();
  const now = new Date().toISOString();
  const actionSummary = normalizeText(input.actionSummary);
  const actionAt = normalizeText(input.actionAt) || now;
  const index = records.findIndex((item) => item.id === id);

  if (index >= 0) {
    const current = records[index];
    records[index] = normalizeExecutionPlanRecord({
      ...current,
      label: normalizeText(input.label) || current.label,
      status: input.status,
      updatedAt: now,
      lastActionAt: actionSummary ? actionAt : current.lastActionAt,
      lastActionSummary: actionSummary || current.lastActionSummary,
      completedAt:
        input.status === "completed"
          ? actionAt
          : input.status === "pending"
            ? ""
            : current.completedAt && current.status === "completed"
              ? current.completedAt
              : "",
      query: {
        country: normalizeText(input.country) || current.query.country,
        degree: normalizeText(input.degree) || current.query.degree,
        major: normalizeText(input.major) || current.query.major,
        specialization:
          normalizeText(input.specialization) || current.query.specialization,
      },
    });
  } else {
    records.push(
      normalizeExecutionPlanRecord({
        id,
        createdAt: now,
        updatedAt: now,
        label: normalizeText(input.label) || "未命名执行计划",
        status: input.status,
        lastActionAt: actionSummary ? actionAt : "",
        lastActionSummary: actionSummary,
        completedAt: input.status === "completed" ? actionAt : "",
        query: {
          country: normalizeText(input.country),
          degree: normalizeText(input.degree),
          major: normalizeText(input.major),
          specialization: normalizeText(input.specialization),
        },
      })
    );
  }

  await writeStudyAbroadSearchExecutionPlanRecords(records);
  const saved = records.find((item) => item.id === id) || null;

  return {
    ok: true,
    message:
      input.status === "completed"
        ? `已把「${saved?.label || "这组执行计划"}」标记为已完成。`
        : input.status === "in_progress"
          ? `已把「${saved?.label || "这组执行计划"}」标记为处理中。`
          : `已把「${saved?.label || "这组执行计划"}」重置为未开始。`,
    record: saved,
  };
}
