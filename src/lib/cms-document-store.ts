import { db, CmsDocument, eq } from "astro:db";

const CMS_DB_DRIVER_VALUES = new Set(["db", "database", "astro-db"]);

export function isCmsDocumentDbEnabled() {
  return CMS_DB_DRIVER_VALUES.has(
    String(import.meta.env?.CMS_STORAGE_DRIVER || process.env.CMS_STORAGE_DRIVER || "")
      .trim()
      .toLowerCase()
  );
}

export async function readCmsJsonDocument<T>(key: string): Promise<T | null> {
  if (!isCmsDocumentDbEnabled()) return null;

  const rows = await db.select().from(CmsDocument).where(eq(CmsDocument.key, key));
  const row = rows[0];

  if (!row?.value) return null;

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export async function writeCmsJsonDocument<T>(key: string, value: T) {
  if (!isCmsDocumentDbEnabled()) return;

  const payload = JSON.stringify(value);
  const now = new Date();
  const rows = await db.select().from(CmsDocument).where(eq(CmsDocument.key, key));

  if (rows.length) {
    await db
      .update(CmsDocument)
      .set({
        value: payload,
        updatedAt: now,
      })
      .where(eq(CmsDocument.key, key));
    return;
  }

  await db.insert(CmsDocument).values({
    key,
    value: payload,
    updatedAt: now,
  });
}
