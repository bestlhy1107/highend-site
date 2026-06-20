import type { APIRoute } from "astro";
import { listOfferCountries, readOffers } from "../../../lib/offers-store";

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

export const GET: APIRoute = async () => {
  try {
    const offers = await readOffers();
    return json({
      ok: true,
      offers,
      countries: listOfferCountries(offers),
    });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Offer 数据读取失败",
      },
      500
    );
  }
};
