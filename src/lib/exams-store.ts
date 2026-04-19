import {
  compareByOrder,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import {
  normalizeFaqArray,
  normalizeStringArray,
  parseFaqLines,
  slugify,
  splitCsv,
  splitLines,
} from "./text-fields";

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

function normalizeExam(input: Partial<RuntimeExam>): RuntimeExam {
  return {
    id: String(input.id ?? "").trim(),
    title: String(input.title ?? "").trim(),
    subtitle: String(input.subtitle ?? "").trim(),
    order: Number(input.order ?? 999),
    summary: String(input.summary ?? "").trim(),
    highlights: normalizeStringArray(input.highlights),
    faqs: normalizeFaqArray(input.faqs),
    tags: normalizeStringArray(input.tags),
  };
}

function isValidExam(item: RuntimeExam) {
  return Boolean(item.id && item.title);
}

export async function readExams(): Promise<RuntimeExam[]> {
  return readJsonArrayFile({
    fileName: "exams.json",
    fallback: DEFAULT_EXAMS,
    normalize: normalizeExam,
    isValid: isValidExam,
    compare: compareByOrder,
  });
}

export async function readExamById(id: string) {
  const exams = await readExams();
  return exams.find((item) => item.id === id) ?? null;
}

export async function writeExams(exams: RuntimeExam[]) {
  return writeJsonArrayFile(exams, {
    fileName: "exams.json",
    normalize: normalizeExam,
    isValid: isValidExam,
    compare: compareByOrder,
  });
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
    highlights: splitLines(input.highlights),
    faqs: parseFaqLines(input.faqs),
    tags: splitCsv(input.tags),
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
