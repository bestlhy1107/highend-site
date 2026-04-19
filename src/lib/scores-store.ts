import {
  compareByOrder,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import { normalizeStringArray, slugify, splitCsv } from "./text-fields";

export type RuntimeScore = {
  id: string;
  exam: string;
  scoreText: string;
  highlight?: string;
  date?: string;
  image: string;
  order: number;
  tags: string[];
};

const DEFAULT_SCORES: RuntimeScore[] = [
  {
    id: "score-1",
    exam: "TOEFL",
    scoreText: "托福 110（口语 27）",
    highlight: "4 周冲刺，口语从 20 → 27",
    date: "2026-01",
    image: "/scores/toefl-110.svg",
    order: 1,
    tags: ["TOEFL", "口语", "冲刺"],
  },
];

function normalizeScore(input: Partial<RuntimeScore>): RuntimeScore {
  return {
    id: String(input.id ?? "").trim(),
    exam: String(input.exam ?? "").trim(),
    scoreText: String(input.scoreText ?? "").trim(),
    highlight: String(input.highlight ?? "").trim(),
    date: String(input.date ?? "").trim(),
    image: String(input.image ?? "").trim(),
    order: Number(input.order ?? 999),
    tags: normalizeStringArray(input.tags),
  };
}

function isValidScore(score: RuntimeScore) {
  return Boolean(score.id && score.scoreText && score.image);
}

export async function readScores(): Promise<RuntimeScore[]> {
  return readJsonArrayFile({
    fileName: "scores.json",
    fallback: DEFAULT_SCORES,
    normalize: normalizeScore,
    isValid: isValidScore,
    compare: compareByOrder,
  });
}

export async function writeScores(scores: RuntimeScore[]) {
  return writeJsonArrayFile(scores, {
    fileName: "scores.json",
    normalize: normalizeScore,
    isValid: isValidScore,
    compare: compareByOrder,
  });
}

export async function upsertScore(input: {
  id?: string;
  exam?: string;
  scoreText: string;
  highlight?: string;
  date?: string;
  image: string;
  order: number;
  tags?: string;
}) {
  const scores = await readScores();
  const id =
    input.id && input.id.trim()
      ? input.id.trim()
      : slugify(input.scoreText) || crypto.randomUUID().slice(0, 8);

  const nextScore: RuntimeScore = {
    id,
    exam: String(input.exam ?? "").trim(),
    scoreText: input.scoreText.trim(),
    highlight: String(input.highlight ?? "").trim(),
    date: String(input.date ?? "").trim(),
    image: input.image.trim(),
    order: Number(input.order),
    tags: splitCsv(input.tags),
  };

  const index = scores.findIndex((score) => score.id === id);

  if (index >= 0) {
    scores[index] = nextScore;
  } else {
    scores.push(nextScore);
  }

  return writeScores(scores);
}

export async function deleteScore(id: string) {
  const scores = await readScores();
  return writeScores(scores.filter((score) => score.id !== id));
}
