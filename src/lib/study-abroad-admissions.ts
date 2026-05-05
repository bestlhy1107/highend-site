import { mkdir, writeFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { dataFilePath, readJsonArrayFile } from "./json-file-store";
import {
  readStudyAbroadFinderProgramById,
  type StudyAbroadFinderProgram,
} from "./study-abroad-catalog-store";

const FETCH_TIMEOUT_MS = 12000;
const INSIGHT_TIMEOUT_MS = 20000;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const CACHE_SCHEMA_VERSION = 3;
const MAX_HTML_CHARS = 750_000;
const MAX_TEXT_NODE_CANDIDATES = 360;
const MAX_TEXT_ITEMS = 120;
const MAX_FALLBACK_TEXT_CHARS = 8_000;
const MAX_GROUP_ITEMS = 5;
const MAX_HIGHLIGHTS = 6;
const MAX_SNIPPET_LENGTH = 240;
const CACHE_FILE = "study-abroad-admissions-cache.json";

const SOURCE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
  "Cache-Control": "no-cache",
} satisfies HeadersInit;

type RequirementCategoryKey =
  | "academic"
  | "language"
  | "tests"
  | "materials"
  | "experience"
  | "deadline";

type RequirementCategory = {
  key: RequirementCategoryKey;
  label: string;
  keywords: string[];
};

export type StudyAbroadRequirementGroup = {
  label: string;
  items: string[];
};

export type StudyAbroadAdmissionsInsight = {
  programId: string;
  schoolName: string;
  programName: string;
  officialWebsite: string;
  overviewUrl: string;
  admissionsUrl: string;
  sourceUrl: string;
  finalUrl: string;
  sourceTitle: string;
  fetchedAt: string;
  summary: string;
  highlights: string[];
  requirementGroups: StudyAbroadRequirementGroup[];
  admissionsProfile: StudyAbroadAdmissionsProfile;
  extractionStatus: "ok" | "partial" | "unavailable";
  note: string;
};

export type StudyAbroadAdmissionsProfile = {
  gpaMin: number | null;
  gpaScale: string;
  ieltsMin: number | null;
  toeflMin: number | null;
  duolingoMin: number | null;
  pteMin: number | null;
  greStatus: "required" | "recommended" | "optional" | "unknown";
  gmatStatus: "required" | "recommended" | "optional" | "unknown";
  workExperienceYears: number | null;
  academicSignals: string[];
  languageSignals: string[];
  testSignals: string[];
};

type StudyAbroadAdmissionsCacheEntry = StudyAbroadAdmissionsInsight & {
  schemaVersion: number;
  updatedAt: string;
};

type ProcessedTextItem = {
  text: string;
  normalized: string;
  score: number;
};

let admissionsCachePromise: Promise<StudyAbroadAdmissionsCacheEntry[]> | null = null;
let admissionsCacheWriteChain = Promise.resolve();

const REQUIREMENT_CATEGORIES: RequirementCategory[] = [
  {
    key: "academic",
    label: "学术背景",
    keywords: [
      "bachelor",
      "bachelor's degree",
      "undergraduate",
      "honours",
      "honors",
      "degree",
      "academic background",
      "background",
      "prerequisite",
      "relevant discipline",
      "related field",
      "quantitative",
      "本科",
      "学位",
      "学术背景",
      "专业背景",
      "先修",
      "相关专业",
      "相关学科",
    ],
  },
  {
    key: "language",
    label: "语言要求",
    keywords: [
      "ielts",
      "toefl",
      "pte",
      "duolingo",
      "english proficiency",
      "english language",
      "language requirement",
      "雅思",
      "托福",
      "多邻国",
      "英语",
      "语言成绩",
    ],
  },
  {
    key: "tests",
    label: "标化考试",
    keywords: [
      "gre",
      "gmat",
      "test score",
      "standardized test",
      "entrance exam",
      "考试成绩",
      "标化",
    ],
  },
  {
    key: "materials",
    label: "申请材料",
    keywords: [
      "resume",
      "cv",
      "statement",
      "essay",
      "personal statement",
      "recommendation",
      "reference",
      "transcript",
      "portfolio",
      "interview",
      "video essay",
      "writing sample",
      "简历",
      "文书",
      "推荐信",
      "成绩单",
      "作品集",
      "面试",
    ],
  },
  {
    key: "experience",
    label: "经验要求",
    keywords: [
      "work experience",
      "professional experience",
      "years of experience",
      "full-time work",
      "leadership",
      "career progression",
      "工作经验",
      "职业经验",
      "管理经验",
    ],
  },
  {
    key: "deadline",
    label: "截止时间",
    keywords: [
      "deadline",
      "round",
      "application closes",
      "submission date",
      "start date",
      "截止",
      "轮次",
      "申请时间",
      "开放申请",
    ],
  },
];

function normalizeWhitespace(value: string) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string) {
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function minOrNull(values: Array<number | null>) {
  const filtered = values.filter((value): value is number => Number.isFinite(value as number));
  return filtered.length ? Math.min(...filtered) : null;
}

function maxOrNull(values: Array<number | null>) {
  const filtered = values.filter((value): value is number => Number.isFinite(value as number));
  return filtered.length ? Math.max(...filtered) : null;
}

function truncateText(value: string, maxLength = MAX_SNIPPET_LENGTH) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function uniqueItems(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  items.forEach((item) => {
    const value = normalizeWhitespace(item);
    if (!value) return;

    const key = value.toLowerCase();
    if (seen.has(key)) return;

    seen.add(key);
    result.push(value);
  });

  return result;
}

function uniqueNumberMatches(matches: number[]) {
  return Array.from(new Set(matches.filter((value) => Number.isFinite(value))));
}

function includesNormalizedKeyword(normalized: string, keywords: string[]) {
  return keywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}

function scoreNormalizedSnippet(normalized: string) {
  let score = 0;

  REQUIREMENT_CATEGORIES.forEach((category) => {
    category.keywords.forEach((keyword) => {
      if (normalized.includes(keyword.toLowerCase())) {
        score += keyword.length > 5 ? 3 : 1;
      }
    });
  });

  if (normalized.includes("require")) score += 3;
  if (normalized.includes("admission")) score += 3;
  if (normalized.includes("apply")) score += 2;

  return score;
}

function buildProcessedTextItems(items: string[]) {
  return items.map((text) => {
    const normalized = text.toLowerCase();
    return {
      text,
      normalized,
      score: scoreNormalizedSnippet(normalized),
    } satisfies ProcessedTextItem;
  });
}

function detectTestStatus(text: string, exam: "gre" | "gmat") {
  const normalized = text.toLowerCase();
  if (!normalized.includes(exam)) {
    return "unknown" as const;
  }

  if (
    /(not required|no gre|no gmat|waived|waiver|optional|not necessary|not needed)/i.test(
      normalized
    )
  ) {
    return "optional" as const;
  }

  if (/(recommended|preferred|strongly encouraged)/i.test(normalized)) {
    return "recommended" as const;
  }

  if (/(required|must submit|must provide|is required)/i.test(normalized)) {
    return "required" as const;
  }

  return "unknown" as const;
}

function extractGpaMin(textItems: string[]) {
  const joined = textItems.join(" \n ");
  const directMatches = [
    ...joined.matchAll(
      /(?:gpa|grade point average|cgpa|cumulative gpa)[^0-9]{0,24}([2-4](?:\.\d{1,2})?)/gi
    ),
    ...joined.matchAll(/([2-4](?:\.\d{1,2})?)\s*(?:\/|out of)\s*4(?:\.0)?/gi),
    ...joined.matchAll(/minimum gpa[^0-9]{0,16}([2-4](?:\.\d{1,2})?)/gi),
  ]
    .map((match) => parseNumber(match[1] ?? ""))
    .filter((value): value is number => value !== null && value >= 2 && value <= 4);

  return minOrNull(uniqueNumberMatches(directMatches));
}

function extractLanguageScore(textItems: ProcessedTextItem[], test: "ielts" | "toefl" | "duolingo" | "pte") {
  const testHints: Record<typeof test, string[]> = {
    ielts: ["ielts", "academic ielts"],
    toefl: ["toefl", "internet-based", "ibt"],
    duolingo: ["duolingo"],
    pte: ["pte", "pearson"],
  };
  const preferredPatterns: Record<typeof test, RegExp[]> = {
    ielts: [
      /overall(?:\s+band)?\s+score(?:\s+must\s+be)?(?:\s+at\s+least)?[^0-9]{0,12}([4-9](?:\.\d)?)/i,
      /at\s+least[^0-9]{0,12}([4-9](?:\.\d)?)/i,
      /minimum[^0-9]{0,12}([4-9](?:\.\d)?)/i,
    ],
    toefl: [
      /total\s+score[^0-9]{0,16}([6-9]\d|1[01]\d|120)/i,
      /at\s+least[^0-9]{0,12}([6-9]\d|1[01]\d|120)/i,
      /minimum[^0-9]{0,12}([6-9]\d|1[01]\d|120)/i,
    ],
    duolingo: [
      /at\s+least[^0-9]{0,12}([7-9]\d|1\d{2}|160)/i,
      /minimum[^0-9]{0,12}([7-9]\d|1\d{2}|160)/i,
    ],
    pte: [
      /at\s+least[^0-9]{0,12}([4-8]\d|90)/i,
      /minimum[^0-9]{0,12}([4-8]\d|90)/i,
      /overall[^0-9]{0,12}([4-8]\d|90)/i,
    ],
  };
  const scorePattern: Record<typeof test, RegExp> = {
    ielts: /\b([4-9](?:\.\d)?)\b/g,
    toefl: /\b([6-9]\d|1[01]\d|120)\b/g,
    duolingo: /\b([7-9]\d|1\d{2}|160)\b/g,
    pte: /\b([4-8]\d|90)\b/g,
  };

  const relevantItems = textItems.filter((item) =>
    testHints[test].some((hint) => item.normalized.includes(hint))
  );

  const preferredValues = relevantItems
    .flatMap((item) =>
      preferredPatterns[test].flatMap((pattern) => {
        const matched = item.text.match(pattern);
        return matched ? [parseNumber(matched[1] ?? "")] : [];
      })
    )
    .filter((value): value is number => value !== null);

  if (preferredValues.length) {
    return maxOrNull(uniqueNumberMatches(preferredValues));
  }

  const values = relevantItems
    .flatMap((item) =>
      Array.from(item.text.matchAll(scorePattern[test])).map((match) =>
        parseNumber(match[1] ?? "")
      )
    )
    .filter((value): value is number => value !== null);

  return maxOrNull(uniqueNumberMatches(values));
}

function extractWorkExperienceYears(textItems: string[]) {
  const joined = textItems.join(" \n ");
  const values = Array.from(
    joined.matchAll(/([1-9])\+?\s+(?:years?|year)\s+(?:of\s+)?work experience/gi)
  )
    .map((match) => parseNumber(match[1] ?? ""))
    .filter((value): value is number => value !== null);

  return maxOrNull(values);
}

function buildAdmissionsProfile(
  processedItems: ProcessedTextItem[],
  requirementGroups: StudyAbroadRequirementGroup[]
) {
  const textItems = processedItems.map((item) => item.text);
  const academicSignals =
    requirementGroups.find((group) => group.label === "学术背景")?.items ?? [];
  const languageSignals =
    requirementGroups.find((group) => group.label === "语言要求")?.items ?? [];
  const testSignals =
    requirementGroups.find((group) => group.label === "标化考试")?.items ?? [];

  const gpaMin = extractGpaMin(textItems);
  const ieltsMin = extractLanguageScore(processedItems, "ielts");
  const toeflMin = extractLanguageScore(processedItems, "toefl");
  const duolingoMin = extractLanguageScore(processedItems, "duolingo");
  const pteMin = extractLanguageScore(processedItems, "pte");
  const workExperienceYears = extractWorkExperienceYears(textItems);
  const examJoined = [...languageSignals, ...testSignals, ...textItems].join(" \n ");

  return {
    gpaMin,
    gpaScale: gpaMin ? "4.0" : "",
    ieltsMin,
    toeflMin,
    duolingoMin,
    pteMin,
    greStatus: detectTestStatus(examJoined, "gre"),
    gmatStatus: detectTestStatus(examJoined, "gmat"),
    workExperienceYears,
    academicSignals,
    languageSignals,
    testSignals,
  } satisfies StudyAbroadAdmissionsProfile;
}

function normalizeProfile(
  input: Partial<StudyAbroadAdmissionsProfile>
): StudyAbroadAdmissionsProfile {
  return {
    gpaMin: normalizePositiveNumber(input.gpaMin),
    gpaScale: String(input.gpaScale ?? "").trim(),
    ieltsMin: normalizePositiveNumber(input.ieltsMin),
    toeflMin: normalizePositiveNumber(input.toeflMin),
    duolingoMin: normalizePositiveNumber(input.duolingoMin),
    pteMin: normalizePositiveNumber(input.pteMin),
    greStatus:
      input.greStatus === "required" ||
      input.greStatus === "recommended" ||
      input.greStatus === "optional"
        ? input.greStatus
        : "unknown",
    gmatStatus:
      input.gmatStatus === "required" ||
      input.gmatStatus === "recommended" ||
      input.gmatStatus === "optional"
        ? input.gmatStatus
        : "unknown",
    workExperienceYears: normalizePositiveNumber(input.workExperienceYears),
    academicSignals: uniqueItems(Array.isArray(input.academicSignals) ? input.academicSignals : []),
    languageSignals: uniqueItems(Array.isArray(input.languageSignals) ? input.languageSignals : []),
    testSignals: uniqueItems(Array.isArray(input.testSignals) ? input.testSignals : []),
  };
}

function normalizeInsight(
  input: Partial<StudyAbroadAdmissionsCacheEntry>
): StudyAbroadAdmissionsCacheEntry {
  return {
    programId: String(input.programId ?? "").trim(),
    schoolName: String(input.schoolName ?? "").trim(),
    programName: String(input.programName ?? "").trim(),
    officialWebsite: String(input.officialWebsite ?? "").trim(),
    overviewUrl: String(input.overviewUrl ?? "").trim(),
    admissionsUrl: String(input.admissionsUrl ?? "").trim(),
    sourceUrl: String(input.sourceUrl ?? "").trim(),
    finalUrl: String(input.finalUrl ?? "").trim(),
    sourceTitle: String(input.sourceTitle ?? "").trim(),
    fetchedAt: String(input.fetchedAt ?? "").trim(),
    summary: String(input.summary ?? "").trim(),
    highlights: uniqueItems(Array.isArray(input.highlights) ? input.highlights : []),
    requirementGroups: Array.isArray(input.requirementGroups)
      ? input.requirementGroups
          .map((group) => ({
            label: String(group?.label ?? "").trim(),
            items: uniqueItems(Array.isArray(group?.items) ? group.items : []),
          }))
          .filter((group) => group.label && group.items.length)
      : [],
    admissionsProfile: normalizeProfile(input.admissionsProfile ?? {}),
    extractionStatus:
      input.extractionStatus === "ok" ||
      input.extractionStatus === "partial" ||
      input.extractionStatus === "unavailable"
        ? input.extractionStatus
        : "unavailable",
    note: String(input.note ?? "").trim(),
    schemaVersion: Number.isFinite(Number(input.schemaVersion))
      ? Number(input.schemaVersion)
      : 0,
    updatedAt: String(input.updatedAt ?? input.fetchedAt ?? "").trim(),
  };
}

function isValidInsight(entry: StudyAbroadAdmissionsCacheEntry) {
  return Boolean(entry.programId && entry.summary && entry.updatedAt);
}

async function readAdmissionsCache() {
  if (!admissionsCachePromise) {
    admissionsCachePromise = readJsonArrayFile<StudyAbroadAdmissionsCacheEntry>({
      fileName: CACHE_FILE,
      fallback: [],
      normalize: normalizeInsight,
      isValid: isValidInsight,
      compare: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    });
  }

  return admissionsCachePromise;
}

function isFreshCacheEntry(entry: StudyAbroadAdmissionsCacheEntry) {
  if (entry.schemaVersion !== CACHE_SCHEMA_VERSION) {
    return false;
  }

  const updatedAt = new Date(entry.updatedAt).getTime();
  return Boolean(updatedAt) && Date.now() - updatedAt <= CACHE_TTL_MS;
}

async function readCachedAdmissionsInsight(programId: string) {
  const cache = await readAdmissionsCache();
  const entry = cache.find((item) => item.programId === programId);
  if (!entry) return null;

  if (!isFreshCacheEntry(entry)) {
    return null;
  }

  return entry;
}

export async function readStudyAbroadCachedAdmissionsInsights(programIds?: string[]) {
  const cache = await readAdmissionsCache();
  const freshEntries = cache.filter(isFreshCacheEntry);

  if (!Array.isArray(programIds) || !programIds.length) {
    return freshEntries;
  }

  const wanted = new Set(programIds.filter(Boolean));
  return freshEntries.filter((entry) => wanted.has(entry.programId));
}

async function writeCachedAdmissionsInsight(insight: StudyAbroadAdmissionsInsight) {
  admissionsCacheWriteChain = admissionsCacheWriteChain.then(async () => {
    const cache = await readAdmissionsCache();
    const nextEntry = normalizeInsight({
      ...insight,
      schemaVersion: CACHE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
    });

    const next = [
      nextEntry,
      ...cache.filter((item) => item.programId !== nextEntry.programId),
    ].slice(0, 500);

    await mkdir(dataFilePath("."), { recursive: true });
    const persisted = [...next].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    await writeFile(dataFilePath(CACHE_FILE), JSON.stringify(persisted, null, 2), "utf8");
    admissionsCachePromise = Promise.resolve(persisted);
  });

  await admissionsCacheWriteChain;
}

function truncateHtml(html: string) {
  if (html.length <= MAX_HTML_CHARS) {
    return html;
  }

  return html.slice(0, MAX_HTML_CHARS);
}

function extractTextNodes(html: string) {
  const safeHtml = truncateHtml(html);
  const $ = cheerio.load(safeHtml);
  $("script, style, noscript, template, svg").remove();

  const sourceTitle = normalizeWhitespace($("title").first().text());
  const metaDescription = normalizeWhitespace(
    $('meta[name="description"]').attr("content") ||
      $('meta[property="og:description"]').attr("content") ||
      ""
  );

  const root =
    $("main").first().length
      ? $("main").first()
      : $("article").first().length
        ? $("article").first()
        : $('[role="main"]').first().length
          ? $('[role="main"]').first()
          : $("body").first();

  const nodeTexts = root
    .find("h1, h2, h3, h4, p, li, td")
    .slice(0, MAX_TEXT_NODE_CANDIDATES)
    .toArray()
    .map((node) => normalizeWhitespace($(node).text()))
    .filter((text) => text.length >= 18 && text.length <= 420);

  const textItems = uniqueItems(nodeTexts).slice(0, MAX_TEXT_ITEMS);

  if (!textItems.length) {
    const fallbackText = root.text().slice(0, MAX_FALLBACK_TEXT_CHARS);
    const fallbackBody = uniqueItems(
      fallbackText
        .split(/(?<=[.?!。；;])\s+/)
        .map((item) => normalizeWhitespace(item))
        .filter((text) => text.length >= 18 && text.length <= 420)
    ).slice(0, MAX_TEXT_ITEMS);

    return {
      sourceTitle,
      metaDescription,
      textItems: fallbackBody,
    };
  }

  return {
    sourceTitle,
    metaDescription,
    textItems,
  };
}

function buildRequirementGroups(processedItems: ProcessedTextItem[]) {
  return REQUIREMENT_CATEGORIES.map((category) => {
    const items = uniqueItems(
      processedItems
        .filter((item) => includesNormalizedKeyword(item.normalized, category.keywords))
        .sort((left, right) => right.score - left.score)
        .map((item) => truncateText(item.text))
    ).slice(0, MAX_GROUP_ITEMS);

    return items.length
      ? {
          label: category.label,
          items,
        }
      : null;
  }).filter((item): item is StudyAbroadRequirementGroup => Boolean(item));
}

function buildHighlights(
  processedItems: ProcessedTextItem[],
  requirementGroups: StudyAbroadRequirementGroup[]
) {
  const highlighted = uniqueItems(
    processedItems
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((item) => truncateText(item.text))
  ).slice(0, MAX_HIGHLIGHTS);

  if (highlighted.length) {
    return highlighted;
  }

  return uniqueItems(
    requirementGroups.flatMap((group) => group.items.map((item) => truncateText(item)))
  ).slice(0, MAX_HIGHLIGHTS);
}

function buildSummary(params: {
  program: StudyAbroadFinderProgram;
  metaDescription: string;
  requirementGroups: StudyAbroadRequirementGroup[];
  highlights: string[];
}) {
  const { program, metaDescription, requirementGroups, highlights } = params;
  const labels = requirementGroups.map((group) => group.label);

  if (labels.length) {
    const topicText =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, 2).join("、")}${labels.length > 2 ? "等信息" : ""}`;

    return `已从 ${program.schoolName} 官方招生页提取到 ${topicText}，可先用作初筛，最终以院校官网原文为准。`;
  }

  if (metaDescription) {
    return truncateText(metaDescription, 180);
  }

  if (highlights[0]) {
    return highlights[0];
  }

  return `当前已定位到 ${program.schoolName} 的官方页面，但还没有从页面正文中稳定抽取出结构化招生要求，建议直接打开官网核对。`;
}

async function fetchAdmissionsPage(sourceUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      headers: SOURCE_HEADERS,
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`官网返回状态 ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("目标页面不是可解析的 HTML 页面");
    }

    return {
      finalUrl: response.url || sourceUrl,
      html: truncateHtml(await response.text()),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function withInsightTimeout<T>(task: Promise<T>, timeoutMs: number) {
  return await Promise.race([
    task,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`招生页抽取超时（>${timeoutMs}ms）`)), timeoutMs);
    }),
  ]);
}

function unavailableInsight(
  program: StudyAbroadFinderProgram,
  sourceUrl: string,
  note: string
): StudyAbroadAdmissionsInsight {
  return {
    programId: program.id,
    schoolName: program.schoolName,
    programName: program.programName,
    officialWebsite: program.officialWebsite,
    overviewUrl: program.overviewUrl,
    admissionsUrl: program.admissionsUrl || "",
    sourceUrl,
    finalUrl: sourceUrl,
    sourceTitle: program.programName,
    fetchedAt: new Date().toISOString(),
    summary: `当前未能自动提取 ${program.schoolName} 官方招生页的结构化要求。`,
    highlights: [],
    requirementGroups: [],
    admissionsProfile: normalizeProfile({}),
    extractionStatus: "unavailable",
    note,
  };
}

export async function readStudyAbroadAdmissionsInsight(programId: string) {
  const cached = await readCachedAdmissionsInsight(programId);
  if (cached) {
    return cached;
  }

  const program = await readStudyAbroadFinderProgramById(programId);

  if (!program) {
    return null;
  }

  const sourceUrl = program.admissionsUrl || program.overviewUrl || program.officialWebsite;
  if (!sourceUrl) {
    return unavailableInsight(program, "", "当前项目还没有可用的官方招生页链接。");
  }

  try {
    const page = await withInsightTimeout(fetchAdmissionsPage(sourceUrl), INSIGHT_TIMEOUT_MS);
    const insightCore = await withInsightTimeout(
      Promise.resolve().then(() => {
        const { sourceTitle, metaDescription, textItems } = extractTextNodes(page.html);
        const processedItems = buildProcessedTextItems(textItems);
        const requirementGroups = buildRequirementGroups(processedItems);
        const highlights = buildHighlights(processedItems, requirementGroups);
        const admissionsProfile = buildAdmissionsProfile(processedItems, requirementGroups);

        return {
          sourceTitle,
          metaDescription,
          requirementGroups,
          highlights,
          admissionsProfile,
        };
      }),
      INSIGHT_TIMEOUT_MS
    );
    const extractionStatus =
      insightCore.requirementGroups.length || insightCore.highlights.length
        ? insightCore.requirementGroups.length >= 2
          ? "ok"
          : "partial"
        : "unavailable";

    const insight = {
      programId: program.id,
      schoolName: program.schoolName,
      programName: program.programName,
      officialWebsite: program.officialWebsite,
      overviewUrl: program.overviewUrl,
      admissionsUrl: program.admissionsUrl || "",
      sourceUrl,
      finalUrl: page.finalUrl,
      sourceTitle: insightCore.sourceTitle || program.programName,
      fetchedAt: new Date().toISOString(),
      summary: buildSummary({
        program,
        metaDescription: insightCore.metaDescription,
        requirementGroups: insightCore.requirementGroups,
        highlights: insightCore.highlights,
      }),
      highlights: insightCore.highlights,
      requirementGroups: insightCore.requirementGroups,
      admissionsProfile: insightCore.admissionsProfile,
      extractionStatus,
      note:
        extractionStatus === "unavailable"
          ? "页面结构较复杂或内容动态加载较多，系统暂未抽取到稳定字段，建议直接打开官网核对。"
          : "内容来自院校官网页面自动提取，仅用于初筛展示，请以官网原文和最新招生公告为准。",
    } satisfies StudyAbroadAdmissionsInsight;

    await writeCachedAdmissionsInsight(insight);
    return insight;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "系统暂时无法读取官方招生页。";
    const insight = unavailableInsight(program, sourceUrl, message);
    await writeCachedAdmissionsInsight(insight);
    return insight;
  }
}
