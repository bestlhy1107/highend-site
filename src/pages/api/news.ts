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
const FETCH_TIMEOUT_MS = 2500;

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
    feed: googleNewsRss('"Duolingo English Test"'),
  },
  {
    source: "TOEIC News",
    tag: "toeic",
    feed: googleNewsRss('TOEIC OR "ETS TOEIC"'),
  },
];

const TAG_KEYWORDS: Record<NewsTag, string[]> = {
  toefl: ["toefl"],
  ielts: ["ielts"],
  gre: ["gre", "graduate record"],
  det: ["duolingo english test", "englishtest.duolingo"],
  toeic: ["toeic"],
};

const FALLBACK_ITEMS: Record<NewsTag, NewsItem[]> = {
  toefl: [
    {
      title: "TOEFL 官方考试信息",
      link: "https://www.ets.org/toefl.html",
      source: "ETS TOEFL",
      snippet: "查看 TOEFL iBT 考试介绍、报名入口、备考资料和官方更新。",
      tag: "toefl",
    },
    {
      title: "TOEFL iBT Test Content",
      link: "https://www.ets.org/toefl/test-takers/ibt/about/content.html",
      source: "ETS TOEFL",
      snippet: "了解阅读、听力、口语、写作四个部分的官方考试内容。",
      tag: "toefl",
    },
  ],
  ielts: [
    {
      title: "IELTS 官方考试信息",
      link: "https://ielts.org/",
      source: "IELTS",
      snippet: "查看 IELTS 考试类型、备考信息、成绩说明和官方资讯。",
      tag: "ielts",
    },
    {
      title: "IELTS Test Types",
      link: "https://ielts.org/take-a-test/test-types",
      source: "IELTS",
      snippet: "了解 IELTS Academic、General Training 以及不同考试形式。",
      tag: "ielts",
    },
  ],
  gre: [
    {
      title: "GRE 官方考试信息",
      link: "https://www.ets.org/gre.html",
      source: "ETS GRE",
      snippet: "查看 GRE 考试介绍、报名入口、备考资源和官方更新。",
      tag: "gre",
    },
    {
      title: "GRE Test Structure",
      link: "https://www.ets.org/gre/test-takers/general-test/about/content-structure.html",
      source: "ETS GRE",
      snippet: "了解 GRE General Test 的考试结构和题型安排。",
      tag: "gre",
    },
  ],
  det: [
    {
      title: "Duolingo English Test 官方信息",
      link: "https://englishtest.duolingo.com/",
      source: "Duolingo English Test",
      snippet: "查看 DET 考试介绍、认可院校、备考说明和官方更新。",
      tag: "det",
    },
    {
      title: "DET Test Readiness",
      link: "https://englishtest.duolingo.com/test-readiness",
      source: "Duolingo English Test",
      snippet: "了解 Duolingo English Test 官方备考建议与练习入口。",
      tag: "det",
    },
  ],
  toeic: [
    {
      title: "TOEIC 官方考试信息",
      link: "https://www.ets.org/toeic.html",
      source: "ETS TOEIC",
      snippet: "查看 TOEIC 考试介绍、报名信息、备考资源和官方更新。",
      tag: "toeic",
    },
    {
      title: "TOEIC Tests",
      link: "https://www.ets.org/toeic/test-takers.html",
      source: "ETS TOEIC",
      snippet: "了解 TOEIC Listening and Reading、Speaking and Writing 等考试。",
      tag: "toeic",
    },
  ],
};

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

    return feed.items
      .slice(0, 12)
      .map((item) => ({
        title: item.title ?? "Untitled",
        link: item.link ?? "#",
        pubDate: item.pubDate ?? item.isoDate,
        source: item.creator ?? source.source,
        snippet: cleanSnippet(item.contentSnippet ?? item.content ?? item.summary),
        tag: source.tag,
      }))
      .filter((item) => {
        const haystack = `${item.title} ${item.link} ${item.snippet}`.toLowerCase();
        return TAG_KEYWORDS[source.tag].some((keyword) => haystack.includes(keyword));
      })
      .slice(0, 8);
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

  let items = settled
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

  if (!items.length) {
    const fallback =
      tag === "all"
        ? Object.values(FALLBACK_ITEMS).flatMap((item) => item)
        : FALLBACK_ITEMS[tag];

    items = fallback.slice(0, limit);
  }

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
