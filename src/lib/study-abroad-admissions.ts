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

type ManualAdmissionsOverride = {
  sourceUrl?: string;
  sourceTitle?: string;
  summary: string;
  highlights: string[];
  requirementGroups: StudyAbroadRequirementGroup[];
  admissionsProfile?: Partial<StudyAbroadAdmissionsProfile>;
  extractionStatus?: "ok" | "partial";
  note: string;
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

const MANUAL_ADMISSIONS_OVERRIDES: Record<string, ManualAdmissionsOverride> = {
  "hkust-mfin": {
    sourceUrl: "https://mfin.hkust.edu.hk/admissions/admissions-requirement",
    sourceTitle: "Admission Requirements | HKUST MSc in Finance",
    summary:
      "已根据 HKUST MSc in Finance 官方招生页补入学术背景、语言要求与标化考试说明，可直接用于金融方向的初筛判断。",
    highlights: [
      "官方要求申请人具备受认可大学的学士学位与良好学术表现。",
      "非英语授课背景申请人需满足 TOEFL iBT 80 或 IELTS 总分 6.5、单项不低于 5.5。",
      "GMAT / GRE 并非强制，但官网明确说明强分会提升竞争力。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "Applicants must possess a Bachelor's degree with satisfactory academic performance from a recognized university or approved institution.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "TOEFL iBT: 80；IELTS Academic: overall 6.5，all sub-scores 5.5（适用于本科授课语言非英语的申请人）。",
        ],
      },
      {
        label: "标化考试",
        items: [
          "GMAT / GRE scores are not required, but strong GMAT / GRE scores will enhance the application.",
        ],
      },
      {
        label: "经验要求",
        items: [
          "Part-time applicants should have at least one year of full-time post-qualification work experience; full-time applicants do not need work experience but relevant experience is preferred.",
        ],
      },
    ],
    admissionsProfile: {
      ieltsMin: 6.5,
      toeflMin: 80,
      greStatus: "optional",
      gmatStatus: "optional",
    },
    extractionStatus: "ok",
    note: "已根据 HKUST 官方招生页人工整理关键门槛，适合前台初筛与顾问快速判断。",
  },
  "nus-mcomp-cs": {
    sourceUrl:
      "https://masters.nus.edu.sg/programmes/master-of-computing/mcomp---computer-science-specialisation",
    sourceTitle: "Computer Science Specialisation | NUS Master of Computing",
    summary:
      "已根据 NUS Master of Computing 官方项目页与 Coursework Programme Guide 补入语言、标化与背景要求。",
    highlights: [
      "申请人需具备 Computing 或相关学科 honours 本科；非 Honours Computing 背景通常需要 2 年 IT 行业经验。",
      "非英语授课背景申请人需满足 TOEFL 90 或 IELTS 6.0。",
      "官网列明 GRE 320 + AW 3.5 或 GMAT 650（或印度院校 GATE）作为 Other requirement。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "Bachelor’s Degree (preferably with Honours) in Computing, or Bachelor’s Degree with Honours in a related discipline, or Bachelor’s Degree (preferably with Honours) in a business-related discipline.",
          "For holders of undergraduate qualifications other than a Bachelor’s Degree with Honours in Computing, two years of IT industry experience.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "Applicants whose medium of university instruction is not completely in English: TOEFL minimum 90 (Internet-based) or IELTS Academic minimum 6.0.",
        ],
      },
      {
        label: "标化考试",
        items: [
          "GRE minimum 320 (Verbal + Quantitative) and 3.5 Analytical Writing, or GMAT minimum 650, or GATE scores for graduates from Indian universities.",
        ],
      },
    ],
    admissionsProfile: {
      ieltsMin: 6.0,
      toeflMin: 90,
      greStatus: "required",
      gmatStatus: "required",
      workExperienceYears: 2,
    },
    extractionStatus: "ok",
    note: "已根据 NUS 官方项目页与官方 coursework guide 人工整理快照，适合计算机方向初筛。",
  },
  "nus-msba": {
    sourceUrl: "https://msba.nus.edu.sg/",
    sourceTitle: "Application Guide for MSBA AY2026/27",
    summary:
      "已根据 NUS MSBA 官方 application guide 与 programme 页面补入申请材料与考试策略，适合商业分析方向初筛。",
    highlights: [
      "官方 guide 明确写明：Applicants do not have to submit any English Language Test (e.g. IELTS / TOEFL).",
      "GMAT / GRE 在 programme 页面标注为 highly recommended，最新 application guide 标为 optional。",
      "申请材料需提交完整学历材料、履历和个人陈述，且需在申请系统内一次性上传完整文件。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "请提交官方或官方认证的本科 / 研究生学历证书与成绩单，并在申请表中填写最终 cumulative GPA。",
        ],
      },
      {
        label: "标化考试",
        items: [
          "GMAT / GRE scores are optional in the latest application guide and highly recommended on the official programme page.",
        ],
      },
      {
        label: "申请材料",
        items: [
          "需提交最新 Resume / CV、学历证明、成绩单以及个人陈述；官方明确不接受提交后补交成绩和文档。",
        ],
      },
    ],
    admissionsProfile: {
      greStatus: "recommended",
      gmatStatus: "recommended",
    },
    extractionStatus: "ok",
    note: "已根据 NUS MSBA 官方申请指南与项目页人工整理快照；该项目当前不要求 IELTS / TOEFL。",
  },
  "smu-applied-finance": {
    sourceUrl: "https://masters.smu.edu.sg/programme/msc-in-applied-finance",
    sourceTitle: "MSc in Applied Finance (MAF) | SMU PG Admissions",
    summary:
      "已根据 SMU Applied Finance 官方项目页补入基础门槛与材料要求，先让金融方向结果不再停留在 unavailable。",
    highlights: [
      "官方项目页列明 prerequisites 为 Bachelor’s Degree、GMAT / GRE / SMU Admissions Test、以及非英语授课背景下的 TOEFL / IELTS。",
      "项目页明确写明 fresh graduates are welcome to apply。",
      "申请材料需提交 updated Resume、官方成绩单、CFA / ACCA 证书（如有）以及两篇 personal statements。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "Pre-requisites include a Bachelor's Degree from a recognized institution.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "TOEFL / IELTS is required if the medium of instruction of undergraduate studies was not in English.",
        ],
      },
      {
        label: "标化考试",
        items: [
          "A good GMAT / GRE / SMU Admissions Test score is part of the admissions requirements.",
        ],
      },
      {
        label: "申请材料",
        items: [
          "需提交 updated Resume、官方成绩单、CFA / ACCA 证书（如有）以及两篇 500-600 字 personal statements。",
        ],
      },
      {
        label: "经验要求",
        items: ["Fresh graduates are welcome to apply."],
      },
    ],
    admissionsProfile: {
      greStatus: "required",
      gmatStatus: "required",
    },
    extractionStatus: "partial",
    note: "已根据 SMU 官方项目页人工整理；页面未给出 TOEFL / IELTS 最低分数，因此先标记为部分结构化快照。",
  },
  "smu-mitb": {
    sourceUrl: "https://masters.smu.edu.sg/programme/master-of-it-in-business",
    sourceTitle: "Master of IT in Business | SMU PG Admissions",
    summary:
      "已根据 SMU MITB 官方项目页补入语言要求、前置考试路径与学术门槛说明，可直接用于新加坡数据方向初筛。",
    highlights: [
      "官网列明 TOEFL 90 / IELTS 6.5 作为非英语授课背景申请人的最低语言门槛。",
      "申请可通过 GMAT / GRE / SMU Admissions Test 路径完成，部分学校背景也可用 CGPA 替代。",
      "MITB 更偏 business + technology 交叉，项目页要求提供更新版简历与成绩单。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "Bachelor's degree from a well-recognised university or tertiary institution with good academic standing.",
          "Applicants from SMU and selected partner universities may use CGPA in lieu of GMAT / GRE / SMU Admissions Test when they meet the official threshold.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "TOEFL minimum 90 or IELTS minimum 6.5 if the medium of instruction of undergraduate studies was not English.",
        ],
      },
      {
        label: "标化考试",
        items: [
          "GMAT / GRE / SMU Admissions Test is part of the admissions pathway unless the applicant qualifies for the official CGPA-based exemption route.",
        ],
      },
      {
        label: "申请材料",
        items: [
          "需要提交 updated Resume / CV 与正式 academic transcripts；项目页也要求完成官方在线申请材料上传。",
        ],
      },
    ],
    admissionsProfile: {
      ieltsMin: 6.5,
      toeflMin: 90,
      greStatus: "required",
      gmatStatus: "required",
    },
    extractionStatus: "ok",
    note: "已根据 SMU 官方项目页人工整理关键门槛；GMAT / GRE / SMUAT 属于三选一路径。",
  },
  "ubc-mban": {
    sourceUrl:
      "https://org-www.sauder.ubc.ca/master-business-analytics/application-process/mban-admission-requirements",
    sourceTitle: "MBAN admission requirements | UBC Sauder",
    summary:
      "已根据 UBC Sauder MBAN 官方 admission requirements 与 UBC Graduate School 语言最低要求补入核心门槛。",
    highlights: [
      "UBC 官方 IELTS minimum table 显示 MBAN 需 overall 7.0，且四项单项均 7.0。",
      "UBC 官方 TOEFL minimum table 显示 MBAN 需总分 100，阅读 / 听力 / 写作 / 口语均至少 25。",
      "Sauder admission requirements 页面明确写明：没有最低工作经验要求，较低学术平均分可由强 GMAT / GRE 或显著职业经历补强。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "Candidates with a lower academic average may be accepted if they have significant professional experience and/or a high GMAT / GRE score.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "UBC Graduate School program minimums for MBAN: IELTS overall 7.0 with 7.0 in each component; TOEFL iBT total 100 with minimum 25 in each section.",
        ],
      },
      {
        label: "标化考试",
        items: [
          "Sauder programme materials mention GMAT / GRE waiver, indicating GMAT / GRE can strengthen the application but may be waived case by case.",
        ],
      },
      {
        label: "经验要求",
        items: [
          "There is no minimum work experience requirement for entry into the UBC MBAN.",
        ],
      },
    ],
    admissionsProfile: {
      ieltsMin: 7.0,
      toeflMin: 100,
      greStatus: "recommended",
      gmatStatus: "recommended",
    },
    extractionStatus: "ok",
    note: "已结合 UBC Sauder 官方 admission requirements 与 UBC Graduate School 语言最低要求人工整理。",
  },
  "melbourne-mit": {
    sourceUrl:
      "https://study.unimelb.edu.au/find/courses/graduate/master-of-information-technology/entry-requirements",
    sourceTitle: "Master of Information Technology : Entry requirements - The University of Melbourne",
    summary:
      "已根据墨尔本大学 MIT 官方 entry requirements 补入英语门槛与入学方式，可直接用于澳洲计算机方向初筛。",
    highlights: [
      "官方 entry requirements 页列明 IELTS 6.5，且写作 / 口语 / 阅读 / 听力均至少 6.0。",
      "同页列明 TOEFL iBT 81，写作 19、口语 19、阅读 16、听力 16；PTE Academic 64，各单项 60。",
      "项目支持不同 IT 背景申请人，并根据先前学习经历决定课长与 entry pathway。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "需具备认可本科学位；学校会根据申请人的前置学习背景评估课程长度与 entry pathway。",
        ],
      },
      {
        label: "语言要求",
        items: [
          "IELTS 6.5 with writing 6.0, speaking 6.0, reading 6.0, listening 6.0.",
          "TOEFL iBT 81 with writing 19, speaking 19, reading 16, listening 16.",
          "PTE Academic 64 with writing / speaking / reading / listening all 60.",
        ],
      },
    ],
    admissionsProfile: {
      ieltsMin: 6.5,
      toeflMin: 81,
      pteMin: 64,
    },
    extractionStatus: "ok",
    note: "已根据墨尔本大学官方 entry requirements 人工整理，规避了原站点 Cloudflare 动态阻挡。",
  },
  "western-mda": {
    sourceUrl: "https://www.uwo.ca/mda/admissions/index.html",
    sourceTitle: "Admissions - Master of Data Analytics - Western University",
    summary:
      "已根据 Western MDA 官方 admissions 页面与 admission requirements PDF 补入英语与先修要求。",
    highlights: [
      "官方要求最后两年课程平均通常不低于 75%，并建议具备统计、线性代数、微积分与编程先修背景。",
      "官方英语门槛为 IELTS 7.0（单项不低于 6.5）、TOEFL iBT 94（R22 / L22 / S26 / W24）、Duolingo 120。",
      "MDA 主页与 admissions 页面都强调项目为 12 个月 course-based 专业硕士，国际申请首轮截止更早。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "Applicants are typically expected to have a minimum 75% average in the last two years of study and prerequisite preparation in statistics, linear algebra, calculus and computer programming.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "IELTS Academic overall 7.0 with no individual band below 6.5.",
          "TOEFL iBT overall 94 with Reading 22, Listening 22, Speaking 26 and Writing 24.",
          "Duolingo English Test minimum 120.",
        ],
      },
    ],
    admissionsProfile: {
      ieltsMin: 7.0,
      toeflMin: 94,
      duolingoMin: 120,
    },
    extractionStatus: "ok",
    note: "已根据 Western 官方 admissions 页面与官方 PDF 人工整理，并修正了原来 404 的招生链接。",
  },
  "toronto-mi": {
    sourceUrl: "https://www.sgs.utoronto.ca/programs/information/",
    sourceTitle: "Information – School of Graduate Studies | University of Toronto",
    summary:
      "已根据多伦多大学 SGS Information programme 页面与通用 graduate admission requirements 补入基础学术门槛。",
    highlights: [
      "官方 Information programme 页显示：MI 最低录取平均分为 B，成功申请者通常至少达到 B+。",
      "SGS 通用硕士录取要求写明：需具备 appropriate bachelor’s degree 或同等学历，final-year average 至少达到 mid-B。",
      "非英语授课背景申请人需按 SGS 英语能力测试政策提交 TOEFL / IELTS 等成绩。",
    ],
    requirementGroups: [
      {
        label: "学术背景",
        items: [
          "MI: minimum admission average is B; successful applicants generally hold a minimum of B+.",
          "For master’s programs, an appropriate bachelor’s degree or equivalent with a final-year average of at least mid-B from a recognized university.",
        ],
      },
      {
        label: "语言要求",
        items: [
          "Applicants from universities outside Canada where English is not the primary language of instruction must provide results of an English language proficiency examination following SGS policy.",
        ],
      },
    ],
    extractionStatus: "partial",
    note: "已根据 U of T SGS 官方 programme page 与通用 admission requirements 人工整理；具体 TOEFL / IELTS 分数仍建议进官网语言政策页核对。",
  },
};

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

function buildManualAdmissionsInsight(
  program: StudyAbroadFinderProgram,
  override: ManualAdmissionsOverride
): StudyAbroadAdmissionsInsight {
  const sourceUrl =
    override.sourceUrl || program.admissionsUrl || program.overviewUrl || program.officialWebsite;
  const extractedAt = new Date().toISOString();

  return {
    programId: program.id,
    schoolName: program.schoolName,
    programName: program.programName,
    officialWebsite: program.officialWebsite,
    overviewUrl: program.overviewUrl,
    admissionsUrl: program.admissionsUrl || "",
    sourceUrl,
    finalUrl: sourceUrl,
    sourceTitle: override.sourceTitle || program.programName,
    fetchedAt: extractedAt,
    summary: normalizeWhitespace(override.summary),
    highlights: uniqueItems(override.highlights),
    requirementGroups: override.requirementGroups
      .map((group) => ({
        label: normalizeWhitespace(group.label),
        items: uniqueItems(group.items),
      }))
      .filter((group) => group.label && group.items.length),
    admissionsProfile: normalizeProfile(override.admissionsProfile ?? {}),
    extractionStatus: override.extractionStatus ?? "ok",
    note: normalizeWhitespace(override.note),
  };
}

export async function readStudyAbroadAdmissionsInsight(programId: string) {
  const cached = await readCachedAdmissionsInsight(programId);
  const manualOverride = MANUAL_ADMISSIONS_OVERRIDES[programId];

  if (cached && (!manualOverride || cached.note.includes("人工整理"))) {
    return cached;
  }

  const program = await readStudyAbroadFinderProgramById(programId);

  if (!program) {
    return null;
  }

  if (manualOverride) {
    const insight = buildManualAdmissionsInsight(program, manualOverride);
    await writeCachedAdmissionsInsight(insight);
    return insight;
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
