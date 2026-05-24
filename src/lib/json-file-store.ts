import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), "data");
const CMS_DB_ARRAY_FILES = new Set([
  "exams.json",
  "scores.json",
  "services.json",
  "teachers.json",
]);
type JsonArrayFileCacheEntry = {
  mtimeMs: number;
  promise: Promise<unknown[]>;
};

const arrayFileCache = new Map<string, JsonArrayFileCacheEntry>();

export function dataFilePath(fileName: string) {
  return join(DATA_DIR, fileName);
}

function cmsDocumentKey(fileName: string) {
  return `json-array:${fileName}`;
}

async function readCmsArrayFile<T>(fileName: string): Promise<T[] | null> {
  if (!CMS_DB_ARRAY_FILES.has(fileName)) return null;

  try {
    const { readCmsJsonDocument } = await import("./cms-document-store");
    const payload = await readCmsJsonDocument<unknown[]>(cmsDocumentKey(fileName));

    return Array.isArray(payload) ? (payload as T[]) : null;
  } catch (error) {
    console.warn(`CMS DB 读取失败，已回退到 JSON 文件：${fileName}`, error);
    return null;
  }
}

async function writeCmsArrayFile<T>(fileName: string, value: T[]) {
  if (!CMS_DB_ARRAY_FILES.has(fileName)) return;

  try {
    const { writeCmsJsonDocument } = await import("./cms-document-store");
    await writeCmsJsonDocument(cmsDocumentKey(fileName), value);
  } catch (error) {
    console.warn(`CMS DB 写入失败，JSON 文件已保留：${fileName}`, error);
  }
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
  const cmsItems = await readCmsArrayFile<Partial<T>>(fileName);
  if (cmsItems) {
    const items = cmsItems.map(normalize).filter(isValid);
    return compare ? items.sort(compare) : items;
  }

  const filePath = dataFilePath(fileName);

  try {
    const fileStat = await stat(filePath);
    const cached = arrayFileCache.get(fileName);
    if (cached && cached.mtimeMs === fileStat.mtimeMs) {
      return (await cached.promise) as T[];
    }

    const nextPromise = (async () => {
      try {
        const raw = await readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);

        if (!Array.isArray(parsed)) return fallback;

        const items = parsed.map(normalize).filter(isValid);
        return compare ? items.sort(compare) : items;
      } catch {
        return fallback;
      }
    })();

    arrayFileCache.set(fileName, {
      mtimeMs: fileStat.mtimeMs,
      promise: nextPromise as Promise<unknown[]>,
    });

    return await nextPromise;
  } catch {
    arrayFileCache.delete(fileName);
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
  const filePath = dataFilePath(fileName);

  await writeFile(filePath, JSON.stringify(sorted, null, 2), "utf8");
  await writeCmsArrayFile(fileName, sorted);
  const fileStat = await stat(filePath);
  arrayFileCache.set(fileName, {
    mtimeMs: fileStat.mtimeMs,
    promise: Promise.resolve(sorted as unknown[]),
  });
  return sorted;
}

export async function getJsonArrayFileVersion(fileName: string) {
  const cached = arrayFileCache.get(fileName);
  if (cached) {
    return cached.mtimeMs;
  }

  try {
    const fileStat = await stat(dataFilePath(fileName));
    return fileStat.mtimeMs;
  } catch {
    return 0;
  }
}

export function invalidateJsonArrayFileCache(fileName?: string) {
  if (fileName) {
    arrayFileCache.delete(fileName);
    return;
  }

  arrayFileCache.clear();
}

export function compareByOrder(a: { order: number }, b: { order: number }) {
  return a.order - b.order;
}
