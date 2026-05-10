import type { APIRoute } from "astro";
import {
  clampNewsLimit,
  normalizeNewsTag,
  readNewsFeed,
} from "../../lib/news-feed";

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    },
  });
}

export const GET: APIRoute = async ({ url }) => {
  const tag = normalizeNewsTag(url.searchParams.get("tag"));
  const limit = clampNewsLimit(url.searchParams.get("limit"));
  const result = await readNewsFeed(tag, limit);

  return json({
    ok: true,
    tag,
    ...result,
  });
};
