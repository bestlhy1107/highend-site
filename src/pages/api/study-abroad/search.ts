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

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function runSearch(payload: Record<string, unknown> = {}) {
  const result = await searchStudyAbroadPrograms({
    searchSessionId: asString(payload.searchSessionId),
    freeText: asString(payload.freeText),
    country: asString(payload.country),
    major: asString(payload.major),
    specialization: asString(payload.specialization),
    degree: asString(payload.degree),
    budgetTier: asString(payload.budgetTier),
    intake: asString(payload.intake),
    gpaProfile: asString(payload.gpaProfile),
    languageProfile: asString(payload.languageProfile),
    fitMode: asString(payload.fitMode),
    snapshotQuality: asString(payload.snapshotQuality),
    universityId: asString(payload.universityId),
    page: asNumber(payload.page),
    pageSize: asNumber(payload.pageSize),
    universityPage: asNumber(payload.universityPage),
    universityPageSize: asNumber(payload.universityPageSize),
  }, {
    includeExternalCandidates: false,
  });

  return json({
    ok: true,
    ...result,
  });
}

export const GET: APIRoute = async ({ url }) => {
  try {
    const payload = Object.fromEntries(url.searchParams.entries());
    return await runSearch(payload);
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

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload = await request.json();
    return await runSearch(payload);
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
