import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, CmsDocument, eq } from "astro:db";

type CmsSeedDocument = {
  key: string;
  file: string;
  kind: "array" | "object";
};

const DOCUMENTS: CmsSeedDocument[] = [
  { key: "site-settings", file: "data/site.json", kind: "object" },
  { key: "json-array:teachers.json", file: "data/teachers.json", kind: "array" },
  { key: "json-array:scores.json", file: "data/scores.json", kind: "array" },
  { key: "json-array:services.json", file: "data/services.json", kind: "array" },
  { key: "json-array:exams.json", file: "data/exams.json", kind: "array" },
];

async function readJsonDocument({ file, kind }: CmsSeedDocument) {
  const raw = await readFile(resolve(process.cwd(), file), "utf8");
  const parsed = JSON.parse(raw) as unknown;

  if (kind === "array" && !Array.isArray(parsed)) {
    throw new Error(`${file} 不是数组 JSON，已跳过`);
  }

  if (
    kind === "object" &&
    (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
  ) {
    throw new Error(`${file} 不是对象 JSON，已跳过`);
  }

  return parsed;
}

async function upsertCmsDocument(key: string, value: unknown) {
  const payload = JSON.stringify(value);
  const now = new Date();
  const rows = await db.select().from(CmsDocument).where(eq(CmsDocument.key, key));

  if (rows.length) {
    await db
      .update(CmsDocument)
      .set({ value: payload, updatedAt: now })
      .where(eq(CmsDocument.key, key));
    return "updated";
  }

  await db.insert(CmsDocument).values({ key, value: payload, updatedAt: now });
  return "inserted";
}

export default async function seedCmsDocuments() {
  for (const document of DOCUMENTS) {
    try {
      const value = await readJsonDocument(document);
      const action = await upsertCmsDocument(document.key, value);
      console.log(`${action}: ${document.key} <- ${document.file}`);
    } catch (error) {
      console.warn(
        `skipped: ${document.key} <- ${document.file}`,
        error instanceof Error ? error.message : error
      );
    }
  }
}
