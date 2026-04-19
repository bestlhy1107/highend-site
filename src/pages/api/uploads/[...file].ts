import type { APIRoute } from "astro";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import { safeUploadPath } from "../../../lib/upload-storage";

function getContentType(ext: string) {
  switch (ext.toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

export const GET: APIRoute = async ({ params }) => {
  const raw = params.file ?? "";
  const parts = raw.split("/").filter(Boolean);

  if (!parts.length) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const filePath = safeUploadPath(...parts);
    const [buffer, meta] = await Promise.all([
      readFile(filePath),
      stat(filePath),
    ]);

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": getContentType(extname(filePath)),
        "Content-Length": String(meta.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};