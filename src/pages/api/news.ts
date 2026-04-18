import type { APIRoute } from "astro";
import Parser from "rss-parser";

type NewsItem = {
  title: string;
  link: string;
  pubDate?: string;
  source: string;
  snippet?: string;
  tag: "all" | "toefl" | "ielts" | "gre" | "det" | "toeic";
};

type Tag = NewsItem["tag"];

type SourceConfig = {
  source: string;
  tag: Exclude<Tag, "all">;
  feed: string;
};

const parser = new Parser();

const TTL = 10 * 60 * 1000;
const cache = new Map<string, { ts: number; items: NewsItem[] }>();

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function googleNewsRss(query: string) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
}

const SOURCE_CONFIGS: SourceConfig[] = [
  {
    source: "TOEFL / ETS",
    tag: "toefl",
    feed: googleNewsRss(
      '(site:ets.org/toefl OR site:toefltest.com OR site:toeflaccess.ets.org) (TOEFL OR "TOEFL iBT")'
    ),
  },
  {
    source: "IELTS Official",
    tag: "ielts",
    feed: googleNewsRss(
      '(site:ielts.org/news-and-insights OR site:ielts.org) IELTS'
    ),
  },
  {
    source: "GRE / ETS",
    tag: "gre",
    feed: googleNewsRss(
      '(site:ets.org/gre OR site:ets.org/news) GRE'
    ),
  },
  {
    source: "DET Official",
    tag: "det",
    feed: googleNewsRss(
      '(site:blog.englishtest.duolingo.com OR site:englishtest.duolingo.com) ("Duolingo English Test" OR DET)'
    ),
  },
  {
    source: "TOEIC / ETS Global",
    tag: "toeic",
    feed: googleNewsRss(
      '(site:etsglobal.org OR site:ets.org) TOEIC'
    ),
  },
];

const FALLBACK: Record<Tag, NewsItem[]> = {
  all: [
    {
      title: "考试动态源已重构完成，默认流只展示考试相关资讯",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "当前默认资讯流已经从综合新闻切换为考试垂类流，后续你只需要继续微调来源和排序规则。",
      tag: "all",
    },
    {
      title: "下一步可继续增加：申请截止日期、奖学金、院校语言要求更新",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "这样首页动态会更贴合留学申请咨询场景，而不只是单纯的考试资讯。",
      tag: "all",
    },
  ],
  toefl: [
    {
      title: "TOEFL 分类源已切换为 ETS / TOEFL 相关域名",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "如果当前时段官方结果较少，会先显示这条兜底内容，避免版面空白。",
      tag: "toefl",
    },
  ],
  ielts: [
    {
      title: "IELTS 分类源已切换为 IELTS 官方资讯域名",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "如果当前时段官方结果较少，会先显示这条兜底内容，避免版面空白。",
      tag: "ielts",
    },
  ],
  gre: [
    {
      title: "GRE 分类源已切换为 ETS GRE 相关域名",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "如果当前时段官方结果较少，会先显示这条兜底内容，避免版面空白。",
      tag: "gre",
    },
  ],
  det: [
    {
      title: "DET 分类源已切换为 Duolingo English Test 官方域名",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "如果当前时段官方结果较少，会先显示这条兜底内容，避免版面空白。",
      tag: "det",
    },
  ],
  toeic: [
    {
      title: "TOEIC 分类源已切换为 ETS Global / ETS 相关域名",
      link: "/#news",
      pubDate: new Date().toISOString(),
      source: "Wanhe Education",
      snippet: "如果当前时段官方结果较少，会先显示这条兜底内容，避免版面空白。",
      tag: "toeic",
    },
  ],
};

function stripHtml(input?: string) {
  return (input ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLink(link?: string) {
  if (!link) return "";
  try {
    const url = new URL(link);
    url.searchParams.delete("utm_source");
    url.searchParams.delete("utm_medium");
    url.searchParams.delete("utm_campaign");
    return url.toString();
  } catch {
    return link;
  }
}

function dedupe(items: NewsItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.title}__${item.link}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchSource(config: SourceConfig): Promise<NewsItem[]> {
  try {
    const feed = await parser.parseURL(config.feed);

    return (feed.items ?? [])
      .map((raw: any) => {
        const title = String(raw.title ?? "").trim();
        const link = normalizeLink(raw.link ?? raw.guid ?? "");
        const snippet = stripHtml(raw.contentSnippet ?? raw.content ?? raw.summary ?? raw.contentEncoded ?? "");
        const pubDate = raw.isoDate ?? raw.pubDate ?? undefined;

        return {
          title,
          link,
          pubDate,
          source: config.source,
          snippet: snippet ? snippet.slice(0, 180) : undefined,
          tag: config.tag,
        } satisfies NewsItem;
      })
      .filter((item) => item.title && item.link);
  } catch {
    return [];
  }
}

function sortByDateDesc(items: NewsItem[]) {
  return [...items].sort((a, b) => {
    const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return tb - ta;
  });
}

export const GET: APIRoute = async ({ url }) => {
  const tag = (url.searchParams.get("tag") || "all").toLowerCase() as Tag;
  const limitRaw = Number(url.searchParams.get("limit") || 6);
  const limit = Math.min(Math.max(limitRaw, 1), 12);

  const safeTag: Tag = ["all", "toefl", "ielts", "gre", "det", "toeic"].includes(tag)
    ? tag
    : "all";

  const cacheKey = `${safeTag}:${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TTL) {
    return json({
      ok: true,
      tag: safeTag,
      items: cached.items,
      cached: true,
    });
  }

  const activeSources =
    safeTag === "all"
      ? SOURCE_CONFIGS
      : SOURCE_CONFIGS.filter((s) => s.tag === safeTag);

  const fetchedGroups = await Promise.all(activeSources.map(fetchSource));
  let items = sortByDateDesc(dedupe(fetchedGroups.flat()));

  if (safeTag !== "all") {
    items = items.filter((item) => item.tag === safeTag);
  }

  const finalItems =
    items.length > 0
      ? items.slice(0, limit)
      : (FALLBACK[safeTag] || FALLBACK.all).slice(0, limit);

  cache.set(cacheKey, {
    ts: Date.now(),
    items: finalItems,
  });

  return json({
    ok: true,
    tag: safeTag,
    items: finalItems,
    cached: false,
    sourceCount: activeSources.length,
  });
};