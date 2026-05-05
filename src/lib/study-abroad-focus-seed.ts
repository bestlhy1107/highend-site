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

const FOCUS_SEED_CHECKED_AT = "2026-05-05";
const FOCUS_SOURCE_ID = "focus-country-official-pages";

type FocusSeedProgram = {
  id: string;
  country: string;
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

const FOCUS_SEED_PROGRAMS: FocusSeedProgram[] = [
  {
    id: "hkust-msba",
    country: "中国香港",
    schoolName: "The Hong Kong University of Science and Technology",
    city: "Hong Kong",
    programName: "MSc in Business Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "港科大官网显示，该项目以 analytics、optimization、data management 与商业决策为核心，强调把 quantitative methods 直接用到真实业务场景中。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "商业分析",
      "business analytics",
      "数据分析",
      "optimization",
      "statistics",
      "decision making",
    ],
    tags: ["中国香港", "商业分析", "数据", "官方课程页"],
    overviewUrl: "https://msba.hkust.edu.hk/program/overview-schedule",
    admissionsUrl: "https://msba.hkust.edu.hk/admission/admission-requirements",
    priority: 90,
  },
  {
    id: "cuhk-mscitm",
    country: "中国香港",
    schoolName: "The Chinese University of Hong Kong",
    city: "Hong Kong",
    programName: "MSc in Information and Technology Management",
    discipline: "商业分析 / 数据",
    summary:
      "港中文官网显示，该项目围绕 digital transformation、AI applications、data analytics 与 IT governance，适合希望走 business technology 路线的申请者。",
    duration: "1 年",
    intake: "8 月",
    keywords: [
      "信息系统",
      "information technology management",
      "data analytics",
      "digital transformation",
      "business technology",
      "ai applications",
    ],
    tags: ["中国香港", "信息系统", "数据", "官方课程页"],
    overviewUrl: "https://masters.bschool.cuhk.edu.hk/programmes/mscitm/",
    admissionsUrl: "https://masters.bschool.cuhk.edu.hk/programmes/mscitm/admissions/",
    priority: 86,
  },
  {
    id: "nus-msba",
    country: "新加坡",
    schoolName: "National University of Singapore",
    city: "Singapore",
    programName: "Master of Science in Business Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "NUS 官方页面显示，MSBA 以数据建模、机器学习与 business applications 为主线，强调把 analytics 转化成可执行的商业洞察与管理决策。",
    duration: "1 年",
    intake: "8 月",
    keywords: [
      "business analytics",
      "商业分析",
      "machine learning",
      "data modeling",
      "statistics",
      "business applications",
    ],
    tags: ["新加坡", "商业分析", "数据", "官方课程页"],
    overviewUrl: "https://msba.nus.edu.sg/",
    admissionsUrl: "https://msba.nus.edu.sg/",
    priority: 93,
  },
  {
    id: "ntu-msai",
    country: "新加坡",
    schoolName: "Nanyang Technological University",
    city: "Singapore",
    programName: "Master of Science in Artificial Intelligence",
    discipline: "计算机 / AI",
    summary:
      "南洋理工官网显示，该项目聚焦 AI fundamentals、machine learning、深度学习与行业应用，面向具备数理与计算基础的申请者。",
    duration: "1 年",
    intake: "8 月",
    keywords: [
      "artificial intelligence",
      "人工智能",
      "machine learning",
      "deep learning",
      "computer vision",
      "nlp",
    ],
    tags: ["新加坡", "人工智能", "机器学习", "官方课程页"],
    overviewUrl:
      "https://www.ntu.edu.sg/education/graduate-programme/master-of-science-in-artificial-intelligence",
    admissionsUrl:
      "https://www.ntu.edu.sg/education/graduate-programme/master-of-science-in-artificial-intelligence",
    priority: 92,
  },
  {
    id: "ntu-msba",
    country: "新加坡",
    schoolName: "Nanyang Technological University",
    city: "Singapore",
    programName: "Master of Science in Business Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "南洋理工官网显示，该项目结合 business knowledge、data management 与 analytics methods，强调在真实商业环境中处理复杂数据问题。",
    duration: "1 年",
    intake: "8 月",
    keywords: [
      "business analytics",
      "商业分析",
      "data management",
      "machine learning",
      "business intelligence",
      "visualisation",
    ],
    tags: ["新加坡", "商业分析", "数据", "官方课程页"],
    overviewUrl:
      "https://www.ntu.edu.sg/education/graduate-programme/master-of-science-in-business-analytics",
    admissionsUrl:
      "https://www.ntu.edu.sg/business/admissions/graduate-studies/msc-business-analytics/admissions",
    priority: 90,
  },
  {
    id: "rotman-mma",
    country: "加拿大",
    schoolName: "University of Toronto",
    city: "Toronto",
    programName: "Master of Management Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "Rotman 官方页面显示，MMA 是面向在职或早期职业阶段申请者的 analytics 项目，强调 machine learning、data science 与 business decision-making 的结合。",
    duration: "11 个月",
    intake: "1 月",
    keywords: [
      "management analytics",
      "business analytics",
      "machine learning",
      "data science",
      "decision making",
      "leadership",
    ],
    tags: ["加拿大", "商业分析", "数据", "官方课程页"],
    overviewUrl:
      "https://www.rotman.utoronto.ca/programs/specialized-programs/master-of-management-analytics/",
    admissionsUrl:
      "https://www.rotman.utoronto.ca/programs/specialized-programs/master-of-management-analytics/",
    priority: 89,
  },
  {
    id: "western-mda",
    country: "加拿大",
    schoolName: "Western University",
    city: "London, Ontario",
    programName: "Master of Data Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "Western 官网显示，MDA 由 engineering、science 与 business 资源共同支持，强调 data analytics、modelling 与 organizational decision support。",
    duration: "16 个月",
    intake: "9 月",
    keywords: [
      "data analytics",
      "数据分析",
      "analytics",
      "modelling",
      "business intelligence",
      "decision support",
    ],
    tags: ["加拿大", "数据分析", "官方课程页"],
    overviewUrl: "https://www.uwo.ca/mda/index.html",
    admissionsUrl: "https://www.uwo.ca/mda/admission/index.html",
    priority: 85,
  },
  {
    id: "sfu-big-data",
    country: "加拿大",
    schoolName: "Simon Fraser University",
    city: "Burnaby",
    programName: "Professional Master of Science in Big Data",
    discipline: "计算机 / AI",
    summary:
      "SFU 官方页面显示，Big Data 项目聚焦大规模数据处理、计算基础设施与 analytics workflows，适合想往技术型 data 路线发展的申请者。",
    duration: "16 个月",
    intake: "9 月",
    keywords: [
      "big data",
      "大数据",
      "data engineering",
      "analytics workflows",
      "distributed systems",
      "machine learning",
    ],
    tags: ["加拿大", "大数据", "计算机", "官方课程页"],
    overviewUrl:
      "https://www.sfu.ca/fas/study/future-graduates/programs/master-big-data.html",
    admissionsUrl:
      "https://www.sfu.ca/fas/study/future-graduates/programs/master-big-data.html",
    priority: 84,
  },
  {
    id: "unsw-mit",
    country: "澳大利亚",
    schoolName: "UNSW Sydney",
    city: "Sydney",
    programName: "Master of Information Technology",
    discipline: "计算机 / AI",
    summary:
      "UNSW 官网显示，MIT 允许学生在人工智能、数据库、电子商务、网络与软件开发等方向深入，面向不同背景申请者提供技术进阶路径。",
    duration: "2 年",
    intake: "2 月 / 9 月",
    keywords: [
      "information technology",
      "信息技术",
      "artificial intelligence",
      "software development",
      "databases",
      "networking",
    ],
    tags: ["澳大利亚", "信息技术", "计算机", "官方课程页"],
    overviewUrl:
      "https://www.unsw.edu.au/study/postgraduate/master-of-information-technology?studentType=international",
    admissionsUrl:
      "https://www.unsw.edu.au/study/postgraduate/master-of-information-technology?studentType=international",
    priority: 87,
  },
  {
    id: "sydney-mds",
    country: "澳大利亚",
    schoolName: "The University of Sydney",
    city: "Sydney",
    programName: "Master of Data Science",
    discipline: "商业分析 / 数据",
    summary:
      "悉尼大学官方页面显示，该项目聚焦 statistical learning、data mining 与 large-scale data analysis，适合希望进入 data-driven industries 的申请者。",
    duration: "1.5 年",
    intake: "2 月 / 8 月",
    keywords: [
      "data science",
      "数据科学",
      "data mining",
      "statistical learning",
      "large scale data",
      "analytics",
    ],
    tags: ["澳大利亚", "数据科学", "官方课程页"],
    overviewUrl:
      "https://www.sydney.edu.au/handbooks/engineering-pg/computer-science/data-science/overview.html",
    admissionsUrl:
      "https://www.sydney.edu.au/handbooks/engineering-pg/computer-science/data-science/overview.html",
    priority: 86,
  },
  {
    id: "uq-mds",
    country: "澳大利亚",
    schoolName: "The University of Queensland",
    city: "Brisbane",
    programName: "Master of Data Science",
    discipline: "商业分析 / 数据",
    summary:
      "昆士兰大学官方页面显示，该项目结合 data analytics、machine learning 与 statistical computing，强调在 research 与 industry 场景中的数据能力。",
    duration: "1.5-2 年",
    intake: "2 月 / 7 月",
    keywords: [
      "data science",
      "数据科学",
      "machine learning",
      "analytics",
      "statistical computing",
      "big data",
    ],
    tags: ["澳大利亚", "数据科学", "机器学习", "官方课程页"],
    overviewUrl:
      "https://study.uq.edu.au/study-options/programs/master-data-science-5660?year=2027",
    admissionsUrl:
      "https://study.uq.edu.au/study-options/programs/master-data-science-5660?year=2027",
    priority: 85,
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

function ensureFocusUniversities(
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

  FOCUS_SEED_PROGRAMS.forEach((program) => {
    const domain = cleanDomain(websiteHost(program.overviewUrl));
    const matched =
      (domain ? byDomain.get(domain) : undefined) ||
      byName.get(normalizeText(program.schoolName));

    if (matched) {
      const current = map.get(matched.id) || matched;
      map.set(matched.id, {
        ...current,
        nameZh: current.nameZh || getStudyAbroadUniversityNameZh(current.name),
        country: current.country || program.country,
        city: current.city || program.city,
        officialWebsite: current.officialWebsite || new URL(program.overviewUrl).origin,
        websiteDomain: current.websiteDomain || domain,
        sourceIds: mergeSourceIds(current.sourceIds, [FOCUS_SOURCE_ID]),
        updatedAt: FOCUS_SEED_CHECKED_AT,
      });
      return;
    }

    const universityId =
      slugify(`${program.schoolName}-${program.country}`) || crypto.randomUUID().slice(0, 8);

    map.set(universityId, {
      id: universityId,
      name: program.schoolName,
      nameZh: getStudyAbroadUniversityNameZh(program.schoolName),
      country: program.country,
      city: program.city,
      stateOrProvince: "",
      officialWebsite: new URL(program.overviewUrl).origin,
      websiteDomain: domain,
      qsRank: null,
      qsRankingYear: null,
      rankingSource: "",
      sourceIds: [FOCUS_SOURCE_ID],
      updatedAt: FOCUS_SEED_CHECKED_AT,
    });
  });

  return Array.from(map.values()).sort((left, right) =>
    `${left.country}-${left.name}`.localeCompare(`${right.country}-${right.name}`, "zh-CN")
  );
}

function mergeFocusPrograms(
  universities: StudyAbroadCatalogUniversity[],
  existingPrograms: StudyAbroadCatalogProgram[]
) {
  const universityByName = new Map(universities.map((item) => [normalizeText(item.name), item]));
  const nextPrograms = new Map(existingPrograms.map((item) => [item.id, item]));

  FOCUS_SEED_PROGRAMS.forEach((program) => {
    const university = universityByName.get(normalizeText(program.schoolName));
    if (!university) return;

    const current = nextPrograms.get(program.id);
    nextPrograms.set(program.id, {
      id: program.id,
      universityId: university.id,
      schoolName: program.schoolName,
      schoolNameZh: university.nameZh || getStudyAbroadUniversityNameZh(program.schoolName),
      country: program.country,
      city: program.city,
      stateOrProvince: current?.stateOrProvince ?? "",
      programName: program.programName,
      degree: "硕士",
      discipline: program.discipline,
      summary: program.summary,
      duration: program.duration,
      intake: program.intake,
      tuitionAmount: current?.tuitionAmount ?? "",
      tuitionCurrency: current?.tuitionCurrency ?? "",
      tuitionNotes: current?.tuitionNotes ?? "",
      overviewUrl: program.overviewUrl,
      admissionsUrl: program.admissionsUrl || program.overviewUrl,
      tuitionUrl: current?.tuitionUrl ?? program.overviewUrl,
      keywords: program.keywords,
      tags: program.tags,
      sourceIds: mergeSourceIds(current?.sourceIds ?? [], [FOCUS_SOURCE_ID]),
      checkedAt: FOCUS_SEED_CHECKED_AT,
      priority: program.priority,
      admissionsSnapshot: current?.admissionsSnapshot ?? null,
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

export async function syncFocusStudyAbroadPilotPrograms() {
  const [existingUniversities, existingPrograms] = await Promise.all([
    readStudyAbroadCatalogUniversities(),
    readStudyAbroadCatalogPrograms(),
  ]);

  const nextUniversities = ensureFocusUniversities(existingUniversities);
  const nextPrograms = mergeFocusPrograms(nextUniversities, existingPrograms);

  const [savedUniversities, savedPrograms] = await Promise.all([
    writeStudyAbroadCatalogUniversities(nextUniversities),
    writeStudyAbroadCatalogPrograms(nextPrograms),
  ]);

  const focusCountries = ["中国香港", "新加坡", "加拿大", "澳大利亚"];
  const focusPrograms = savedPrograms.filter((item) => focusCountries.includes(item.country));
  const focusSchoolsWithPrograms = new Set(focusPrograms.map((item) => item.universityId)).size;
  const focusUniversities = savedUniversities.filter((item) =>
    focusCountries.includes(item.country)
  );

  return {
    ok: true,
    importedProgramCount: focusPrograms.length,
    focusUniversityCount: focusUniversities.length,
    focusSchoolWithProgramCount: focusSchoolsWithPrograms,
    message: `已同步重点国家官方项目种子：当前中国香港 / 新加坡 / 加拿大 / 澳大利亚共 ${focusUniversities.length} 所学校，其中 ${focusSchoolsWithPrograms} 所已补项目层，共 ${focusPrograms.length} 个项目。`,
  };
}
