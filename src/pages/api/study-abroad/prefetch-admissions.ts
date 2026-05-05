import type { APIRoute } from "astro";
import { prefetchStudyAbroadAdmissionsSnapshots } from "../../../lib/study-abroad-admissions-sync";

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

    const result = await prefetchStudyAbroadAdmissionsSnapshots({
      maxPrograms: Number(payload?.maxPrograms) || undefined,
      country: payload?.country,
      degree: payload?.degree,
      major: payload?.major,
      specialization: payload?.specialization,
      programIds: Array.isArray(payload?.programIds) ? payload.programIds : [],
    });

    return json(result);
  } catch {
    return json(
      {
        ok: false,
        message: "后台补抓招生门槛失败，请稍后再试。",
      },
      400
    );
  }
};
