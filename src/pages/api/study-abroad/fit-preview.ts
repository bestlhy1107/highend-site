import type { APIRoute } from "astro";
import { buildStudyAbroadFitPreviews } from "../../../lib/study-abroad-fit";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();
    const programIds = Array.isArray(payload?.programIds) ? payload.programIds : [];

    if (!programIds.length) {
      return json(
        {
          ok: false,
          message: "缺少 programIds，无法生成匹配预估。",
        },
        400
      );
    }

    const previews = await buildStudyAbroadFitPreviews(programIds, {
      gpaProfile: payload?.gpaProfile,
      languageProfile: payload?.languageProfile,
    });

    return json({
      ok: true,
      previews,
    });
  } catch {
    return json(
      {
        ok: false,
        message: "生成匹配预估失败，请稍后再试。",
      },
      400
    );
  }
};
