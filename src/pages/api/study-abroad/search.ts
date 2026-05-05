import type { APIRoute } from "astro";
import { searchStudyAbroadPrograms } from "../../../lib/study-abroad-search";

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
    const result = await searchStudyAbroadPrograms({
      country: payload?.country,
      major: payload?.major,
      specialization: payload?.specialization,
      degree: payload?.degree,
      budgetTier: payload?.budgetTier,
      intake: payload?.intake,
      gpaProfile: payload?.gpaProfile,
      languageProfile: payload?.languageProfile,
      fitMode: payload?.fitMode,
      snapshotQuality: payload?.snapshotQuality,
      universityId: payload?.universityId,
    });

    return json({
      ok: true,
      ...result,
    });
  } catch {
    return json(
      {
        ok: false,
        message: "搜索请求失败，请稍后再试。",
      },
      400
    );
  }
};
