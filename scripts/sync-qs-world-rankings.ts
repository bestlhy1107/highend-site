import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const QS_ALGOLIA_APP_ID = "B9VSLB5GUV";
const QS_ALGOLIA_SEARCH_KEY = "c5a76d12563aa226198ec3dc8c27fefb";
const QS_UNIVERSITY_INDEX = "live_tu_universities";
const QS_RANKING_YEAR = 2027;
const QS_SOURCE = "QS World University Rankings 2027";
const QS_SOURCE_URL = "https://www.topuniversities.com/world-university-rankings";
const OUTPUT_URL = new URL("../data/qs-world-university-rankings-2027.json", import.meta.url);

type QsAlgoliaHit = {
  title?: string;
  content_path?: string;
  wur_rank?: string | number | null;
  campus_country?: string | string[] | null;
  campus_locality?: string | string[] | null;
  objectID?: string;
};

type QsRankingEntry = {
  name: string;
  rank: number;
  rankDisplay: string;
  year: number;
  source: string;
  sourceUrl: string;
  country: string;
  city: string;
  contentPath: string;
  objectId: string;
};

function firstValue(value: string | string[] | null | undefined) {
  if (Array.isArray(value)) return String(value[0] ?? "").trim();
  return String(value ?? "").trim();
}

function parseQsRank(value: string | number | null | undefined) {
  const display = String(value ?? "").trim();
  const match = display.match(/\d+/);
  if (!match) return null;

  const rank = Number(match[0]);
  return Number.isFinite(rank) && rank > 0 ? { rank, display } : null;
}

async function fetchPage(page: number, hitsPerPage: number) {
  const response = await fetch(
    `https://${QS_ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${QS_UNIVERSITY_INDEX}/query`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-API-Key": QS_ALGOLIA_SEARCH_KEY,
        "X-Algolia-Application-Id": QS_ALGOLIA_APP_ID,
      },
      body: JSON.stringify({
        query: "",
        page,
        hitsPerPage,
        attributesToRetrieve: [
          "title",
          "content_path",
          "wur_rank",
          "campus_country",
          "campus_locality",
          "objectID",
        ],
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`QS Algolia request failed: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as {
    hits: QsAlgoliaHit[];
    nbPages: number;
    nbHits: number;
  };
}

async function main() {
  const hitsPerPage = 1000;
  const firstPage = await fetchPage(0, hitsPerPage);
  const allHits = [...firstPage.hits];

  for (let page = 1; page < firstPage.nbPages; page += 1) {
    const result = await fetchPage(page, hitsPerPage);
    allHits.push(...result.hits);
  }

  const entries: QsRankingEntry[] = allHits
    .map((hit) => {
      const parsedRank = parseQsRank(hit.wur_rank);
      const name = String(hit.title ?? "").trim();
      if (!name || !parsedRank) return null;

      return {
        name,
        rank: parsedRank.rank,
        rankDisplay: parsedRank.display,
        year: QS_RANKING_YEAR,
        source: QS_SOURCE,
        sourceUrl: QS_SOURCE_URL,
        country: firstValue(hit.campus_country),
        city: firstValue(hit.campus_locality),
        contentPath: String(hit.content_path ?? "").trim(),
        objectId: String(hit.objectID ?? "").trim(),
      } satisfies QsRankingEntry;
    })
    .filter((item): item is QsRankingEntry => Boolean(item))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.name.localeCompare(right.name, "en-US");
    });

  const payload = {
    source: QS_SOURCE,
    sourceUrl: QS_SOURCE_URL,
    index: QS_UNIVERSITY_INDEX,
    year: QS_RANKING_YEAR,
    fetchedAt: new Date().toISOString(),
    totalHits: firstPage.nbHits,
    rankedCount: entries.length,
    items: entries,
  };

  await mkdir(dirname(OUTPUT_URL.pathname), { recursive: true });
  await writeFile(OUTPUT_URL, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        output: OUTPUT_URL.pathname,
        totalHits: firstPage.nbHits,
        rankedCount: entries.length,
      },
      null,
      2
    )
  );
}

await main();
