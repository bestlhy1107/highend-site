import type { APIRoute } from "astro";
import { readStudyAbroadAdmissionsInsight } from "../../../lib/study-abroad-admissions";

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
    const programId = String(payload?.programId ?? "").trim();

    if (!programId) {
      return json(
        {
          ok: false,
          message: "缺少 programId，无法读取招生要求。",
        },
        400
      );
    }

    const insight = await readStudyAbroadAdmissionsInsight(programId);

    if (!insight) {
      return json(
        {
          ok: false,
          message: "没有找到对应的留学项目。",
        },
        404
      );
    }

    return json({
      ok: true,
      insight,
    });
  } catch {
    return json(
      {
        ok: false,
        message: "读取招生要求失败，请稍后再试。",
      },
      400
    );
  }
};
