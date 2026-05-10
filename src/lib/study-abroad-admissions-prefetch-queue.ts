import { randomUUID } from "node:crypto";
import { prefetchStudyAbroadAdmissionsSnapshots } from "./study-abroad-admissions-sync";

type PrefetchInput = NonNullable<
  Parameters<typeof prefetchStudyAbroadAdmissionsSnapshots>[0]
>;

type PrefetchJobStatus = "queued" | "running" | "completed" | "failed";

type PrefetchJob = {
  id: string;
  signature: string;
  createdAt: string;
  updatedAt: string;
  status: PrefetchJobStatus;
  input: PrefetchInput;
  result: Awaited<ReturnType<typeof prefetchStudyAbroadAdmissionsSnapshots>> | null;
  error: string;
};

const MAX_JOBS = 60;
const RECENT_JOB_WINDOW_MS = 10 * 60 * 1000;
const jobs = new Map<string, PrefetchJob>();
const queue: string[] = [];
let workerPromise: Promise<void> | null = null;

function normalizeProgramIds(programIds: string[] | undefined) {
  return Array.isArray(programIds)
    ? Array.from(
        new Set(programIds.map((item) => String(item ?? "").trim()).filter(Boolean))
      ).sort()
    : [];
}

function normalizePrefetchInput(input: Parameters<typeof prefetchStudyAbroadAdmissionsSnapshots>[0]) {
  return {
    maxPrograms: Number(input?.maxPrograms) || undefined,
    country: String(input?.country ?? "").trim(),
    degree: String(input?.degree ?? "").trim(),
    major: String(input?.major ?? "").trim(),
    specialization: String(input?.specialization ?? "").trim(),
    programIds: normalizeProgramIds(input?.programIds),
  } satisfies PrefetchInput;
}

function buildSignature(input: PrefetchInput) {
  return JSON.stringify({
    maxPrograms: input.maxPrograms ?? 0,
    country: input.country,
    degree: input.degree,
    major: input.major,
    specialization: input.specialization,
    programIds: input.programIds,
  });
}

function trimJobs() {
  const sortedJobs = Array.from(jobs.values()).sort(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );

  sortedJobs.slice(MAX_JOBS).forEach((job) => {
    jobs.delete(job.id);
  });
}

function findReusableJob(signature: string) {
  const now = Date.now();

  return Array.from(jobs.values()).find((job) => {
    if (job.signature !== signature) {
      return false;
    }

    if (job.status === "queued" || job.status === "running") {
      return true;
    }

    const updatedAt = new Date(job.updatedAt).getTime();
    return Boolean(updatedAt) && now - updatedAt <= RECENT_JOB_WINDOW_MS;
  });
}

async function runWorker() {
  while (queue.length) {
    const jobId = queue.shift();
    if (!jobId) {
      continue;
    }

    const job = jobs.get(jobId);
    if (!job || job.status !== "queued") {
      continue;
    }

    job.status = "running";
    job.updatedAt = new Date().toISOString();

    try {
      const result = await prefetchStudyAbroadAdmissionsSnapshots(job.input);
      job.status = "completed";
      job.result = result;
      job.error = "";
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    } finally {
      job.updatedAt = new Date().toISOString();
      trimJobs();
    }
  }
}

function ensureWorker() {
  if (workerPromise) {
    return workerPromise;
  }

  workerPromise = runWorker().finally(() => {
    workerPromise = null;
    if (queue.length) {
      void ensureWorker();
    }
  });

  return workerPromise;
}

export function readStudyAbroadAdmissionsPrefetchJob(jobId: string) {
  return jobs.get(String(jobId ?? "").trim()) ?? null;
}

export function enqueueStudyAbroadAdmissionsPrefetch(
  input: Parameters<typeof prefetchStudyAbroadAdmissionsSnapshots>[0]
) {
  const normalizedInput = normalizePrefetchInput(input);
  const signature = buildSignature(normalizedInput);
  const reusable = findReusableJob(signature);

  if (reusable) {
    return {
      queued: false,
      reused: true,
      jobId: reusable.id,
      status: reusable.status,
      message:
        reusable.status === "queued" || reusable.status === "running"
          ? "相同筛选条件的门槛补抓任务已经在后台队列中。"
          : "相同筛选条件的门槛补抓结果刚刚生成，可直接继续搜索查看最新快照。",
    };
  }

  const now = new Date().toISOString();
  const job: PrefetchJob = {
    id: randomUUID(),
    signature,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    input: normalizedInput,
    result: null,
    error: "",
  };

  jobs.set(job.id, job);
  queue.push(job.id);
  trimJobs();
  void ensureWorker();

  return {
    queued: true,
    reused: false,
    jobId: job.id,
    status: job.status,
    message: "已加入后台补抓队列，稍后会自动补齐前排项目的官网门槛。",
  };
}
