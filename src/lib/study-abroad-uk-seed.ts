import {
  readStudyAbroadCatalogPrograms,
  readStudyAbroadCatalogUniversities,
  writeStudyAbroadCatalogPrograms,
  writeStudyAbroadCatalogUniversities,
  type StudyAbroadCatalogProgram,
  type StudyAbroadCatalogUniversity,
} from "./study-abroad-catalog-store";
import { getStudyAbroadUniversityNameZh } from "./study-abroad-university-names";
import { slugify } from "./text-fields";

const UK_SEED_CHECKED_AT = "2026-04-29";
const UK_SOURCE_ID = "uk-official-postgraduate-pages";

type UkSeedProgram = {
  id: string;
  schoolName: string;
  city: string;
  programName: string;
  discipline: string;
  summary: string;
  duration: string;
  intake: string;
  keywords: string[];
  tags: string[];
  overviewUrl: string;
  admissionsUrl?: string;
  priority: number;
};

const UK_SEED_PROGRAMS: UkSeedProgram[] = [
  {
    id: "imperial-advanced-computing-msc",
    schoolName: "Imperial College London",
    city: "London",
    programName: "Advanced Computing MSc",
    discipline: "计算机 / AI",
    summary:
      "帝国理工官网显示，该项目聚焦 advanced computing concepts and technologies，面向有计算机背景的申请者，课程覆盖前沿计算方向并强调工业应用与软件开发能力。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "计算机",
      "computer science",
      "advanced computing",
      "software development",
      "machine learning",
      "人工智能",
    ],
    tags: ["英国", "计算机", "AI", "官方课程页"],
    overviewUrl: "https://www.imperial.ac.uk/study/courses/postgraduate-taught/2026/advanced-computing/",
    admissionsUrl: "https://www.imperial.ac.uk/study/courses/postgraduate-taught/2026/advanced-computing/",
    priority: 92,
  },
  {
    id: "kcl-artificial-intelligence-msc",
    schoolName: "King's College London",
    city: "London",
    programName: "Artificial Intelligence MSc",
    discipline: "计算机 / AI",
    summary:
      "伦敦国王学院官网显示，该项目围绕 AI theory and practice，覆盖机器学习、推理、交互与 autonomous agents，并以 safe and trusted AI 为主线。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "人工智能",
      "artificial intelligence",
      "ai",
      "machine learning",
      "data science",
      "robotics",
    ],
    tags: ["英国", "人工智能", "机器学习", "官方课程页"],
    overviewUrl: "https://www.kcl.ac.uk/study/postgraduate/taught-courses/artificial-intelligence-msc",
    admissionsUrl:
      "https://www.kcl.ac.uk/study/postgraduate-taught/courses/artificial-intelligence-msc/requirements",
    priority: 91,
  },
  {
    id: "warwick-business-analytics-ai-msc",
    schoolName: "University of Warwick",
    city: "Coventry",
    programName: "Business Analytics & Artificial Intelligence (MSc)",
    discipline: "商业分析 / 数据",
    summary:
      "华威大学官网显示，该项目以 descriptive、predictive 和 prescriptive analytics 为核心，结合 AI、统计、优化与机器学习，强调复杂数据驱动商业环境中的分析能力。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "商业分析",
      "business analytics",
      "artificial intelligence",
      "ai",
      "machine learning",
      "optimization",
    ],
    tags: ["英国", "商业分析", "AI", "官方课程页"],
    overviewUrl: "https://warwick.ac.uk/study/postgraduate/courses/msc-business-analytics",
    admissionsUrl: "https://warwick.ac.uk/study/postgraduate/courses/msc-business-analytics",
    priority: 90,
  },
  {
    id: "warwick-data-analytics-msc",
    schoolName: "University of Warwick",
    city: "Coventry",
    programName: "Data Analytics (MSc)",
    discipline: "商业分析 / 数据",
    summary:
      "华威大学官网显示，该项目面向具备计算机、数学或物理科学背景的学生，结合 computer science、business、engineering 与 mathematics 的视角训练数据分析能力。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "数据分析",
      "data analytics",
      "computer science",
      "mathematics",
      "data mining",
      "visualisation",
    ],
    tags: ["英国", "数据分析", "官方课程页"],
    overviewUrl: "https://warwick.ac.uk/study/postgraduate/courses/msc-data-analytics/",
    admissionsUrl: "https://warwick.ac.uk/study/postgraduate/courses/msc-data-analytics/",
    priority: 89,
  },
  {
    id: "manchester-msc-finance",
    schoolName: "University of Manchester",
    city: "Manchester",
    programName: "MSc Finance",
    discipline: "金融",
    summary:
      "曼彻斯特大学官网显示，该项目面向希望进入 finance 职业路径或继续 PhD 的申请者，采用 staged admissions process，并提供与交易训练机构合作的 bootcamp 体验。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "金融",
      "finance",
      "master of finance",
      "trading",
      "investment",
      "banking",
    ],
    tags: ["英国", "金融", "官方课程页"],
    overviewUrl: "https://www.manchester.ac.uk/study/masters/courses/list/01383/msc-finance/",
    admissionsUrl: "https://www.manchester.ac.uk/study/masters/courses/list/01383/msc-finance/",
    priority: 88,
  },
  {
    id: "bristol-data-science-msc",
    schoolName: "University of Bristol",
    city: "Bristol",
    programName: "MSc Data Science",
    discipline: "商业分析 / 数据",
    summary:
      "布里斯托大学官网显示，该项目强调 computational 与 statistical principles of modern data science，适合具备数理、工程或计算机背景的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "数据科学",
      "data science",
      "statistics",
      "computational",
      "machine learning",
      "data engineer",
    ],
    tags: ["英国", "数据科学", "官方课程页"],
    overviewUrl: "https://www.bristol.ac.uk/study/postgraduate/taught-2025/msc-data-science/",
    admissionsUrl: "https://www.bristol.ac.uk/study/postgraduate/taught-2025/msc-data-science/",
    priority: 88,
  },
  {
    id: "bristol-data-science-for-business-msc",
    schoolName: "University of Bristol",
    city: "Bristol",
    programName: "MSc Data Science for Business",
    discipline: "商业分析 / 数据",
    summary:
      "布里斯托大学官网显示，该项目由 Business School 与 Engineering Mathematics and Technology 跨学院开设，强调将 data science skills 直接应用到 business contexts。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "数据科学",
      "business analytics",
      "data science for business",
      "marketing",
      "finance",
      "supply chain",
    ],
    tags: ["英国", "商业分析", "数据科学", "官方课程页"],
    overviewUrl: "https://www.bristol.ac.uk/study/postgraduate/taught/msc-data-science-for-business/",
    admissionsUrl: "https://www.bristol.ac.uk/study/postgraduate/taught/msc-data-science-for-business/",
    priority: 87,
  },
];

function websiteHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function cleanDomain(domain: string) {
  return String(domain || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function normalizeText(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function mergeSourceIds(current: string[], incoming: string[]) {
  return Array.from(new Set([...current, ...incoming].filter(Boolean)));
}

function ensureUkUniversities(
  existingUniversities: StudyAbroadCatalogUniversity[]
) {
  const map = new Map(existingUniversities.map((item) => [item.id, item]));
  const byDomain = new Map(
    existingUniversities
      .filter((item) => item.websiteDomain)
      .map((item) => [cleanDomain(item.websiteDomain), item])
  );
  const byName = new Map(
    existingUniversities.map((item) => [normalizeText(item.name), item])
  );

  UK_SEED_PROGRAMS.forEach((program) => {
    const domain = cleanDomain(websiteHost(program.overviewUrl));
    const matched =
      (domain ? byDomain.get(domain) : undefined) ||
      byName.get(normalizeText(program.schoolName));

    if (matched) {
      const current = map.get(matched.id) || matched;
      map.set(matched.id, {
        ...current,
        nameZh: current.nameZh || getStudyAbroadUniversityNameZh(current.name),
        city: current.city || program.city,
        officialWebsite: current.officialWebsite || new URL(program.overviewUrl).origin,
        websiteDomain: current.websiteDomain || domain,
        sourceIds: mergeSourceIds(current.sourceIds, [UK_SOURCE_ID]),
        updatedAt: UK_SEED_CHECKED_AT,
      });
      return;
    }

    const universityId = slugify(`${program.schoolName}-uk`) || crypto.randomUUID().slice(0, 8);
    map.set(universityId, {
      id: universityId,
      name: program.schoolName,
      nameZh: getStudyAbroadUniversityNameZh(program.schoolName),
      country: "英国",
      city: program.city,
      stateOrProvince: "",
      officialWebsite: new URL(program.overviewUrl).origin,
      websiteDomain: domain,
      qsRank: null,
      qsRankingYear: null,
      rankingSource: "",
      sourceIds: [UK_SOURCE_ID],
      updatedAt: UK_SEED_CHECKED_AT,
    });
  });

  return Array.from(map.values()).sort((left, right) =>
    `${left.country}-${left.name}`.localeCompare(`${right.country}-${right.name}`, "zh-CN")
  );
}

function mergeUkPrograms(
  universities: StudyAbroadCatalogUniversity[],
  existingPrograms: StudyAbroadCatalogProgram[]
) {
  const universityByName = new Map(
    universities.map((item) => [normalizeText(item.name), item])
  );

  const preservedPrograms = existingPrograms.filter(
    (item) => !item.sourceIds.includes(UK_SOURCE_ID)
  );
  const nextPrograms = new Map<string, StudyAbroadCatalogProgram>();

  preservedPrograms.forEach((item) => {
    nextPrograms.set(item.id, item);
  });

  UK_SEED_PROGRAMS.forEach((program) => {
    const university = universityByName.get(normalizeText(program.schoolName));
    if (!university) {
      return;
    }
    const current = nextPrograms.get(program.id);

    nextPrograms.set(program.id, {
      ...current,
      id: program.id,
      universityId: university.id,
      schoolName: university.name,
      schoolNameZh: university.nameZh || getStudyAbroadUniversityNameZh(university.name),
      country: "英国",
      city: program.city,
      stateOrProvince: "",
      programName: program.programName,
      degree: "硕士",
      discipline: program.discipline,
      summary: program.summary,
      duration: program.duration,
      intake: program.intake,
      tuitionAmount: "",
      tuitionCurrency: "",
      tuitionNotes: "",
      overviewUrl: program.overviewUrl,
      admissionsUrl: program.admissionsUrl || program.overviewUrl,
      tuitionUrl: program.overviewUrl,
      keywords: program.keywords,
      tags: program.tags,
      sourceIds: mergeSourceIds(current?.sourceIds ?? [], [UK_SOURCE_ID]),
      checkedAt: UK_SEED_CHECKED_AT,
      priority: program.priority,
    });
  });

  return Array.from(nextPrograms.values()).sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }

    return `${left.country}-${left.schoolName}-${left.programName}`.localeCompare(
      `${right.country}-${right.schoolName}-${right.programName}`,
      "zh-CN"
    );
  });
}

export async function syncUkStudyAbroadPilotPrograms() {
  const [existingUniversities, existingPrograms] = await Promise.all([
    readStudyAbroadCatalogUniversities(),
    readStudyAbroadCatalogPrograms(),
  ]);

  const nextUniversities = ensureUkUniversities(existingUniversities);
  const nextPrograms = mergeUkPrograms(nextUniversities, existingPrograms);

  const [savedUniversities, savedPrograms] = await Promise.all([
    writeStudyAbroadCatalogUniversities(nextUniversities),
    writeStudyAbroadCatalogPrograms(nextPrograms),
  ]);

  const ukPrograms = savedPrograms.filter((item) => item.country === "英国");
  const ukSchoolsWithPrograms = new Set(ukPrograms.map((item) => item.universityId)).size;
  const ukUniversities = savedUniversities.filter((item) => item.country === "英国");

  return {
    ok: true,
    importedProgramCount: ukPrograms.length,
    ukUniversityCount: ukUniversities.length,
    ukSchoolWithProgramCount: ukSchoolsWithPrograms,
    message: `已同步英国硕士项目种子：当前英国学校 ${ukUniversities.length} 所，其中 ${ukSchoolsWithPrograms} 所已补项目层，共 ${ukPrograms.length} 个项目。`,
  };
}
