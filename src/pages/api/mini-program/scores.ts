import type { APIRoute } from "astro";
import { readScores } from "../../../lib/scores-store";

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
    const scores = await readScores();
    return json({ ok: true, scores });
  } catch (error) {
    return json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "出分数据读取失败",
      },
      500
    );
  }
};
