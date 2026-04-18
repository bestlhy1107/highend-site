import type { APIRoute } from "astro";
import { mkdir, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";

export const prerender = false;

function safeFileName(name: string) {
  return name
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export const POST: APIRoute = async (context) => {
  const adminUser = await context.session?.get("adminUser");

  if (!adminUser) {
    return new Response(
      JSON.stringify({ ok: false, message: "未登录管理员后台" }),
      {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  const formData = await context.request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return new Response(
      JSON.stringify({ ok: false, message: "没有接收到图片文件" }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  if (!file.type.startsWith("image/")) {
    return new Response(
      JSON.stringify({ ok: false, message: "只允许上传图片文件" }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  if (file.size > 5 * 1024 * 1024) {
    return new Response(
      JSON.stringify({ ok: false, message: "图片不能超过 5MB" }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" },
      }
    );
  }

  const uploadsDir = join(process.cwd(), "public", "uploads", "services");
  await mkdir(uploadsDir, { recursive: true });

  const originalName = file.name || "service-image";
  const ext = extname(originalName) || ".jpg";
  const baseName = safeFileName(originalName) || "service-image";
  const filename = `${Date.now()}-${baseName}${ext}`;
  const filepath = join(uploadsDir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const publicPath = `/uploads/services/${filename}`;

  return new Response(
    JSON.stringify({
      ok: true,
      message: "上传成功",
      path: publicPath,
    }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }
  );
};