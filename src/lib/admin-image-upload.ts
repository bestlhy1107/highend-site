import crypto from "node:crypto";
import { extname } from "node:path";
import { writeFile } from "node:fs/promises";
import { ensureUploadDir, safeUploadPath, toUploadApiUrl } from "./upload-storage";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
]);

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

const MAX_BYTES = 5 * 1024 * 1024;

export async function saveAdminImage(
  file: File,
  folder: "teachers" | "services"
) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("仅支持 jpg / png / webp / gif / svg");
  }

  if (file.size > MAX_BYTES) {
    throw new Error("图片不能超过 5MB");
  }

  await ensureUploadDir(folder);

  const ext =
    extname(file.name).toLowerCase() ||
    EXT_BY_TYPE[file.type] ||
    ".jpg";

  const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
  const diskPath = safeUploadPath(folder, filename);
  const buffer = Buffer.from(await file.arrayBuffer());

  await writeFile(diskPath, buffer);

  return {
    fileName: filename,
    relativePath: `${folder}/${filename}`,
    publicPath: toUploadApiUrl(`${folder}/${filename}`),
  };
}