import type { APIRoute } from "astro";
import { hasAdminSession, unauthorizedJson } from "../../../lib/admin-auth";
import { saveAdminImage } from "../../../lib/admin-image-upload";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async (context) => {
  if (!(await hasAdminSession(context))) {
    return unauthorizedJson();
  }

  try {
    const { request } = context;
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return json({ ok: false, message: "请选择图片文件" }, 400);
    }

    const saved = await saveAdminImage(file, "teachers");

    return json({
      ok: true,
      path: saved.publicPath,
      fileName: saved.fileName,
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "上传失败",
      },
      400
    );
  }
};
