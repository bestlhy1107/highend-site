import type { APIRoute } from "astro";
import { enqueueStudyAbroadAdmissionsPrefetch } from "../../../lib/study-abroad-admissions-prefetch-queue";
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
    const input = {
      maxPrograms: Number(payload?.maxPrograms) || undefined,
      country: payload?.country,
      degree: payload?.degree,
      major: payload?.major,
      specialization: payload?.specialization,
      programIds: Array.isArray(payload?.programIds) ? payload.programIds : [],
    };

    if (payload?.waitForCompletion === true) {
      const result = await prefetchStudyAbroadAdmissionsSnapshots(input);
      return json(result);
    }

    const queued = enqueueStudyAbroadAdmissionsPrefetch(input);

    return json({
      ok: true,
      queued: queued.queued,
      reused: queued.reused,
      jobId: queued.jobId,
      status: queued.status,
      updatedPrograms: [],
      message: queued.message,
      filters: {
        country: String(payload?.country ?? "").trim(),
        degree: String(payload?.degree ?? "").trim(),
        major: String(payload?.major ?? "").trim(),
        specialization: String(payload?.specialization ?? "").trim(),
      },
    });
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
