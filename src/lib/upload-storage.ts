import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_UPLOAD_ROOT = resolve(process.cwd(), "public", "uploads");

export const UPLOAD_ROOT =
  process.env.RAILWAY_VOLUME_MOUNT_PATH || DEFAULT_UPLOAD_ROOT;

export function safeUploadPath(...parts: string[]) {
  const root = resolve(UPLOAD_ROOT);
  const target = resolve(root, ...parts);

  if (!target.startsWith(root)) {
    throw new Error("非法文件路径");
  }

  return target;
}

export async function ensureUploadDir(folder: string) {
  await mkdir(safeUploadPath(folder), { recursive: true });
}

export function toUploadApiUrl(input: string) {
  const clean = input
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\//, "");

  return `/api/uploads/${clean}`;
}