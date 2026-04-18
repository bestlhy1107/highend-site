import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeExamFaq = {
  q: string;
  a: string;
};

export type RuntimeExam = {
  id: string;
  title: string;
  subtitle: string;
  order: number;
  summary?: string;
  highlights: string[];
  faqs: RuntimeExamFaq[];
  tags: string[];
};

const DEFAULT_EXAMS: RuntimeExam[] = [
  {
    id: "toefl",
    title: "TOEFL",
    subtitle: "托福系统课程与提分规划",
    order: 1,
    summary: "托福课程覆盖词汇、阅读、听力、口语、写作与模考训练。",
    highlights: ["口语精修", "写作反馈", "阶段测评", "模考复盘"],
    faqs: [
      {
        q: "需要基础吗？",
        a: "可以先做诊断，再安排对应班型。",
      },
    ],
    tags: ["TOEFL", "口语", "写作", "模考"],
  },
];

function getExamsFilePath() {
  return join(process.cwd(), "data", "exams.json");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeExam(input: Partial<RuntimeExam>): RuntimeExam {
  return {
    id: String(input.id ?? "").trim(),
    title: String(input.title ?? "").trim(),
    subtitle: String(input.subtitle ?? "").trim(),
    order: Number(input.order ?? 999),
    summary: String(input.summary ?? "").trim(),
    highlights: Array.isArray(input.highlights)
      ? input.highlights.map((s) => String(s)).filter(Boolean)
      : [],
    faqs: Array.isArray(input.faqs)
      ? input.faqs
          .map((item) => ({
            q: String(item?.q ?? "").trim(),
            a: String(item?.a ?? "").trim(),
          }))
          .filter((item) => item.q && item.a)
      : [],
    tags: Array.isArray(input.tags)
      ? input.tags.map((s) => String(s)).filter(Boolean)
      : [],
  };
}

export async function readExams(): Promise<RuntimeExam[]> {
  try {
    const raw = await readFile(getExamsFilePath(), "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return DEFAULT_EXAMS;

    return parsed
      .map(normalizeExam)
      .filter((item) => item.id && item.title)
      .sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_EXAMS;
  }
}

export async function readExamById(id: string) {
  const exams = await readExams();
  return exams.find((item) => item.id === id) ?? null;
}

export async function writeExams(exams: RuntimeExam[]) {
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });

  const normalized = exams
    .map(normalizeExam)
    .filter((item) => item.id && item.title)
    .sort((a, b) => a.order - b.order);

  await writeFile(getExamsFilePath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

export async function upsertExam(input: {
  id?: string;
  title: string;
  subtitle?: string;
  order: number;
  summary?: string;
  highlights?: string;
  faqs?: string;
  tags?: string;
}) {
  const exams = await readExams();

  const id =
    input.id && input.id.trim()
      ? input.id.trim()
      : slugify(input.title) || crypto.randomUUID().slice(0, 8);

  const nextItem: RuntimeExam = {
    id,
    title: input.title.trim(),
    subtitle: String(input.subtitle ?? "").trim(),
    order: Number(input.order),
    summary: String(input.summary ?? "").trim(),
    highlights: String(input.highlights ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    faqs: String(input.faqs ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          q: String(parts[0] ?? "").trim(),
          a: String(parts[1] ?? "").trim(),
        };
      })
      .filter((item) => item.q && item.a),
    tags: String(input.tags ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const index = exams.findIndex((item) => item.id === id);

  if (index >= 0) {
    exams[index] = nextItem;
  } else {
    exams.push(nextItem);
  }

  return writeExams(exams);
}

export async function deleteExam(id: string) {
  const exams = await readExams();
  const next = exams.filter((item) => item.id !== id);
  return writeExams(next);
}