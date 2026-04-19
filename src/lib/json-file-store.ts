import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");

export function dataFilePath(fileName: string) {
  return join(DATA_DIR, fileName);
}

type JsonArrayOptions<T> = {
  fileName: string;
  fallback: T[];
  normalize: (input: Partial<T>) => T;
  isValid: (item: T) => boolean;
  compare?: (a: T, b: T) => number;
};

export async function readJsonArrayFile<T>({
  fileName,
  fallback,
  normalize,
  isValid,
  compare,
}: JsonArrayOptions<T>): Promise<T[]> {
  try {
    const raw = await readFile(dataFilePath(fileName), "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return fallback;

    const items = parsed.map(normalize).filter(isValid);
    return compare ? items.sort(compare) : items;
  } catch {
    return fallback;
  }
}

export async function writeJsonArrayFile<T>(
  items: T[],
  { fileName, normalize, isValid, compare }: Omit<JsonArrayOptions<T>, "fallback">
) {
  await mkdir(DATA_DIR, { recursive: true });

  const normalized = items.map(normalize).filter(isValid);
  const sorted = compare ? normalized.sort(compare) : normalized;

  await writeFile(dataFilePath(fileName), JSON.stringify(sorted, null, 2), "utf8");
  return sorted;
}

export function compareByOrder(a: { order: number }, b: { order: number }) {
  return a.order - b.order;
}
