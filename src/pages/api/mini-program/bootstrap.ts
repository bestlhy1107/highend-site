import type { APIRoute } from "astro";
import { readOffers } from "../../../lib/offers-store";
import { PUBLIC_OFFER_CASE_COUNT, PUBLIC_SCORE_CASE_COUNT } from "../../../lib/public-metrics";
import { readScores } from "../../../lib/scores-store";
import { readSiteSettings } from "../../../lib/site-store";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function splitOptions(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export const GET: APIRoute = async () => {
  try {
    const [site, scores, offers] = await Promise.all([
      readSiteSettings(),
      readScores(),
      readOffers(),
    ]);

    return json({
      ok: true,
      site: {
        companyName: site.companyName,
        slogan: site.slogan,
        phone: site.phone,
        email: site.email,
        wechat: site.wechat,
        consultTeacherName: site.consultTeacherName,
        consultTeacherAvatar: site.consultTeacherAvatar,
        consultStatusText: site.consultStatusText,
        consultWelcomeMessage: site.consultWelcomeMessage,
        consultCountryPrompt: site.consultCountryPrompt,
        consultCountryOptions: splitOptions(site.consultCountryOptions),
        consultStagePrompt: site.consultStagePrompt,
        consultStageOptions: splitOptions(site.consultStageOptions),
        consultContactMessage: site.consultContactMessage,
      },
      scores,
      offers,
      meta: {
        scoreCount: PUBLIC_SCORE_CASE_COUNT,
        offerCount: PUBLIC_OFFER_CASE_COUNT,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "小程序数据读取失败",
      },
      500
    );
  }
};
