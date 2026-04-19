import type { APIRoute } from "astro";
import Parser from "rss-parser";

type NewsTag = "toefl" | "ielts" | "gre" | "det" | "toeic";

type NewsItem = {
  title: string;
  link: string;
  pubDate?: string;
  source: string;
  snippet?: string;
  tag: NewsTag;
};

type SourceConfig = {
  source: string;
  tag: NewsTag;
  feed: string;
};

const parser = new Parser();
const CACHE_TTL = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4500;

const cache = new Map<string, { time: number; items: NewsItem[] }>();

function googleNewsRss(query: string) {
  const q = `${query} when:90d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
}

const SOURCES: SourceConfig[] = [
  {
    source: "TOEFL News",
    tag: "toefl",
    feed: googleNewsRss('TOEFL OR "TOEFL iBT" OR "ETS TOEFL"'),
  },
  {
    source: "IELTS News",
    tag: "ielts",
    feed: googleNewsRss('IELTS OR "British Council IELTS" OR "IDP IELTS"'),
  },
  {
    source: "GRE News",
    tag: "gre",
    feed: googleNewsRss('GRE OR "ETS GRE" OR "Graduate Record Examination"'),
  },
  {
    source: "DET News",
    tag: "det",
    feed: googleNewsRss('"Duolingo English Test" OR DET'),
  },
  {
    source: "TOEIC News",
    tag: "toeic",
    feed: googleNewsRss('TOEIC OR "ETS TOEIC"'),
  },
];

function json(data: unknown) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

function clampLimit(value: string | null) {
  const parsed = Number(value ?? 6);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(Math.max(Math.trunc(parsed), 1), 12);
}

function normalizeTag(value: string | null): NewsTag | "all" {
  const tag = String(value ?? "all").toLowerCase();
  return tag === "toefl" ||
    tag === "ielts" ||
    tag === "gre" ||
    tag === "det" ||
    tag === "toeic"
    ? tag
    : "all";
}

function cleanSnippet(input?: string) {
  return String(input ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function fetchTextWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "WanheEducationNewsBot/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Feed returned ${response.status}`);
    }

    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSource(source: SourceConfig): Promise<NewsItem[]> {
  try {
    const xml = await fetchTextWithTimeout(source.feed);
    const feed = await parser.parseString(xml);

    return feed.items.slice(0, 8).map((item) => ({
      title: item.title ?? "Untitled",
      link: item.link ?? "#",
      pubDate: item.pubDate ?? item.isoDate,
      source: item.creator ?? source.source,
      snippet: cleanSnippet(item.contentSnippet ?? item.content ?? item.summary),
      tag: source.tag,
    }));
  } catch {
    return [];
  }
}

async function fetchTag(tag: NewsTag | "all", limit: number) {
  const cacheKey = `${tag}:${limit}`;
  const hit = cache.get(cacheKey);

  if (hit && Date.now() - hit.time < CACHE_TTL) {
    return { items: hit.items, cached: true };
  }

  const sources = tag === "all" ? SOURCES : SOURCES.filter((item) => item.tag === tag);
  const settled = await Promise.allSettled(sources.map(fetchSource));
  const seen = new Set<string>();

  const items = settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => {
      const key = `${item.link}|${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.pubDate ?? 0).getTime();
      const tb = new Date(b.pubDate ?? 0).getTime();
      return tb - ta;
    })
    .slice(0, limit);

  cache.set(cacheKey, { time: Date.now(), items });
  return { items, cached: false };
}

export const GET: APIRoute = async ({ url }) => {
  const tag = normalizeTag(url.searchParams.get("tag"));
  const limit = clampLimit(url.searchParams.get("limit"));
  const { items, cached } = await fetchTag(tag, limit);

  return json({
    ok: true,
    tag,
    items,
    cached,
  });
};
