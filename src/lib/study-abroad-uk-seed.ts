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
    id: "ual-design-management-ma",
    schoolName: "University of the Arts London",
    city: "London",
    programName: "MA Design Management",
    discipline: "设计 / 艺术",
    summary:
      "伦敦艺术大学官网显示，该项目将 design management 置于跨学科协作与组织变革语境中，强调设计研究、沟通分析与 leadership 能力，并鼓励把设计方法应用到 brand、strategy 与 business development 场景。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "设计管理",
      "design management",
      "strategic design",
      "brand",
      "design research",
      "creative leadership",
    ],
    tags: ["英国", "设计", "设计管理", "官方课程页"],
    overviewUrl: "https://www.arts.ac.uk/subjects/business-and-management-and-science/postgraduate/ma-design-management-lcc",
    admissionsUrl:
      "https://www.arts.ac.uk/subjects/business-and-management-and-science/postgraduate/ma-design-management-lcc",
    priority: 89,
  },
  {
    id: "brunel-design-strategy-innovation-ma",
    schoolName: "Brunel University of London",
    city: "London",
    programName: "Design Strategy and Innovation MA",
    discipline: "设计 / 艺术",
    summary:
      "布鲁内尔大学官网显示，该项目把 design thinking 作为 innovation catalyst，围绕 products、services、processes 与 creative collaboration 展开，适合希望把设计方法应用到组织创新与战略实践中的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "设计策略",
      "design strategy",
      "innovation",
      "design thinking",
      "creative collaboration",
      "service design",
    ],
    tags: ["英国", "设计", "创新", "官方课程页"],
    overviewUrl: "https://www.brunel.ac.uk/study/courses/design-strategy-and-innovation-ma",
    admissionsUrl: "https://www.brunel.ac.uk/study/courses/design-strategy-and-innovation-ma",
    priority: 87,
  },
  {
    id: "newcastle-advanced-architectural-design-msc",
    schoolName: "Newcastle University",
    city: "Newcastle upon Tyne",
    programName: "Advanced Architectural Design MSc",
    discipline: "建筑 / 城市规划",
    summary:
      "纽卡斯尔大学官网显示，该项目面向希望继续强化 architectural design 能力的国际申请者，强调 design and research skills，并依托 studio 与实践导向环境推进空间与建筑表达训练。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "建筑",
      "architectural design",
      "architecture",
      "studio",
      "spatial design",
      "design research",
    ],
    tags: ["英国", "建筑", "建筑设计", "官方课程页"],
    overviewUrl: "https://www.ncl.ac.uk/postgraduate/degrees/5383f/",
    admissionsUrl: "https://www.ncl.ac.uk/postgraduate/degrees/5383f/",
    priority: 86,
  },
  {
    id: "manchester-planning-msc",
    schoolName: "University of Manchester",
    city: "Manchester",
    programName: "MSc Planning",
    discipline: "建筑 / 城市规划",
    summary:
      "曼彻斯特大学官网显示，该项目聚焦 urban and environmental planning，强调把 planning policies 与 theories 放到真实 development 场景中训练，适合希望进入规划与城市发展相关职业路径的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "城市规划",
      "planning",
      "urban planning",
      "environmental planning",
      "development",
      "policy",
    ],
    tags: ["英国", "城市规划", "空间发展", "官方课程页"],
    overviewUrl: "https://www.manchester.ac.uk/study/masters/courses/list/09421/msc-planning/",
    admissionsUrl: "https://www.manchester.ac.uk/study/masters/courses/list/09421/msc-planning/",
    priority: 85,
  },
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
  {
    id: "ucl-business-analytics-msc",
    schoolName: "University College London",
    city: "London",
    programName: "Business Analytics MSc",
    discipline: "商业分析 / 数据",
    summary:
      "UCL 官网显示，该项目关注 data and analytics 在 strategy、marketing 与 operations 中的应用，训练学生处理数据、提取价值、可视化并清晰沟通商业问题解决方案。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "商业分析",
      "business analytics",
      "data analytics",
      "strategy",
      "marketing analytics",
      "operations analytics",
    ],
    tags: ["英国", "商业分析", "数据", "官方课程页"],
    overviewUrl:
      "https://www.ucl.ac.uk/prospective-students/graduate/taught-degrees/business-analytics-msc",
    admissionsUrl:
      "https://www.ucl.ac.uk/prospective-students/graduate/taught-degrees/business-analytics-msc",
    priority: 91,
  },
  {
    id: "leeds-business-analytics-decision-sciences-msc",
    schoolName: "University of Leeds",
    city: "Leeds",
    programName: "Business Analytics and Decision Sciences MSc",
    discipline: "商业分析 / 数据",
    summary:
      "利兹大学官网显示，该项目强调 business analytics、decision sciences、数据建模与决策优化，适合希望在商业数据、运营分析与咨询方向发展的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "商业分析",
      "business analytics",
      "decision sciences",
      "data modelling",
      "optimization",
      "operations analytics",
    ],
    tags: ["英国", "商业分析", "决策科学", "官方课程页"],
    overviewUrl:
      "https://courses.leeds.ac.uk/i954/business-analytics-and-decision-sciences-msc",
    admissionsUrl:
      "https://courses.leeds.ac.uk/i954/business-analytics-and-decision-sciences-msc",
    priority: 86,
  },
  {
    id: "lse-media-communications-msc",
    schoolName: "London School of Economics and Political Science",
    city: "London",
    programName: "MSc Media and Communications",
    discipline: "市场营销 / 传媒",
    summary:
      "LSE 官网显示，该项目提供对 technology、media、representation 与社会权力分配的批判性理解，适合希望进入媒体、传播、公共事务或数字平台研究方向的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "传媒",
      "media",
      "communications",
      "digital media",
      "technology",
      "representation",
    ],
    tags: ["英国", "传媒", "传播", "官方课程页"],
    overviewUrl: "https://www.lse.ac.uk/study-at-lse/graduate/msc-media-and-communications",
    admissionsUrl: "https://www.lse.ac.uk/study-at-lse/graduate/msc-media-and-communications",
    priority: 89,
  },
  {
    id: "ucl-human-computer-interaction-msc",
    schoolName: "University College London",
    city: "London",
    programName: "Human-Computer Interaction MSc",
    discipline: "设计 / 艺术",
    summary:
      "UCL 官网显示，HCI 项目位于 engineering、behavioural sciences 与 design 交叉点，聚焦人与系统之间的界面设计与技术使用体验，兼具学术严谨性和实践技能训练。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "交互设计",
      "human-computer interaction",
      "hci",
      "ux",
      "user experience",
      "interface design",
    ],
    tags: ["英国", "交互设计", "UX", "官方课程页"],
    overviewUrl:
      "https://www.ucl.ac.uk/prospective-students/graduate/taught-degrees/human-computer-interaction-msc",
    admissionsUrl:
      "https://www.ucl.ac.uk/prospective-students/graduate/taught-degrees/human-computer-interaction-msc",
    priority: 90,
  },
  {
    id: "ucl-disability-design-innovation-msc",
    schoolName: "University College London",
    city: "London",
    programName: "Disability, Design and Innovation MSc",
    discipline: "设计 / 艺术",
    summary:
      "UCL 官网显示，该项目融合 research、engineering、design skills 与 disability inclusion 语境，适合关注包容性设计、服务创新与社会影响力方向的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "包容性设计",
      "inclusive design",
      "disability innovation",
      "design innovation",
      "service design",
      "social impact",
    ],
    tags: ["英国", "设计", "创新", "官方课程页"],
    overviewUrl:
      "https://www.ucl.ac.uk/prospective-students/graduate/taught-degrees/disability-design-and-innovation-msc",
    admissionsUrl:
      "https://www.ucl.ac.uk/prospective-students/graduate/taught-degrees/disability-design-and-innovation-msc",
    priority: 86,
  },
  {
    id: "edinburgh-design-informatics-msc",
    schoolName: "University of Edinburgh",
    city: "Edinburgh",
    programName: "Design Informatics MSc",
    discipline: "设计 / 艺术",
    summary:
      "爱丁堡大学官网显示，Design Informatics 结合 design、data、AI 与 interaction，关注数字技术如何塑造产品、服务和社会体验，适合交互、服务与数字产品设计方向申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "design informatics",
      "设计信息学",
      "interaction design",
      "service design",
      "data",
      "digital product",
    ],
    tags: ["英国", "设计", "交互", "官方课程页"],
    overviewUrl:
      "https://www.ed.ac.uk/studying/postgraduate/degrees/index.php?r=site/view&id=845",
    admissionsUrl:
      "https://www.ed.ac.uk/studying/postgraduate/degrees/index.php?r=site/view&id=845",
    priority: 88,
  },
  {
    id: "loughborough-user-experience-design-msc",
    schoolName: "Loughborough University",
    city: "Loughborough",
    programName: "User Experience and Service Design MA",
    discipline: "设计 / 艺术",
    summary:
      "拉夫堡大学官网显示，该项目聚焦 user experience、service design 与设计研究方法，适合希望进入 UX、服务创新、用户研究与数字产品设计方向的申请者。",
    duration: "1 年",
    intake: "10 月",
    keywords: [
      "user experience",
      "ux",
      "service design",
      "用户体验",
      "user research",
      "digital product",
    ],
    tags: ["英国", "UX", "服务设计", "官方课程页"],
    overviewUrl:
      "https://www.lboro.ac.uk/study/postgraduate/masters-degrees/a-z/user-experience-service-design/",
    admissionsUrl:
      "https://www.lboro.ac.uk/study/postgraduate/masters-degrees/a-z/user-experience-service-design/",
    priority: 87,
  },
  {
    id: "glasgow-design-innovation-service-design-msc",
    schoolName: "University of Glasgow",
    city: "Glasgow",
    programName: "Design Innovation and Service Design MSc",
    discipline: "设计 / 艺术",
    summary:
      "格拉斯哥大学官网显示，该项目聚焦 service design、innovation methods 与跨学科协作，适合希望将设计用于公共服务、商业服务与体验创新方向的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "service design",
      "服务设计",
      "design innovation",
      "experience design",
      "design strategy",
      "innovation",
    ],
    tags: ["英国", "服务设计", "创新", "官方课程页"],
    overviewUrl:
      "https://www.gla.ac.uk/postgraduate/taught/designinnovationandservicedesign/",
    admissionsUrl:
      "https://www.gla.ac.uk/postgraduate/taught/designinnovationandservicedesign/",
    priority: 86,
  },
  {
    id: "oxford-advanced-computer-science-msc",
    schoolName: "University of Oxford",
    city: "Oxford",
    programName: "MSc in Advanced Computer Science",
    discipline: "计算机 / AI",
    summary:
      "牛津大学官网显示，该项目覆盖 machine learning、computer security、quantum information 与 formal verification 等高级主题，强调理论与实践结合以及坚实的数学基础。",
    duration: "12 个月",
    intake: "10 月",
    keywords: [
      "计算机",
      "advanced computer science",
      "machine learning",
      "computer security",
      "formal verification",
      "quantum information",
    ],
    tags: ["英国", "计算机", "牛津", "官方课程页"],
    overviewUrl: "https://www.ox.ac.uk/admissions/graduate/courses/msc-advanced-computer-science",
    admissionsUrl: "https://www.ox.ac.uk/admissions/graduate/courses/msc-advanced-computer-science",
    priority: 94,
  },
  {
    id: "edinburgh-artificial-intelligence-msc",
    schoolName: "University of Edinburgh",
    city: "Edinburgh",
    programName: "MSc Artificial Intelligence",
    discipline: "计算机 / AI",
    summary:
      "爱丁堡大学信息学院页面显示，MSc Artificial Intelligence 属于 Informatics 授课型研究生项目，面向希望系统训练 AI、机器学习与智能系统能力的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "人工智能",
      "artificial intelligence",
      "machine learning",
      "informatics",
      "intelligent systems",
      "ai",
    ],
    tags: ["英国", "人工智能", "机器学习", "官方课程页"],
    overviewUrl:
      "https://www.ed.ac.uk/studying/postgraduate/degrees/index.php?r=site/view&id=107",
    admissionsUrl:
      "https://science-engineering.ed.ac.uk/studying/postgraduate/taught-postgraduate/application-and-selection-deadlines/informatics",
    priority: 92,
  },
  {
    id: "manchester-advanced-computer-science-msc",
    schoolName: "University of Manchester",
    city: "Manchester",
    programName: "MSc Advanced Computer Science",
    discipline: "计算机 / AI",
    summary:
      "曼彻斯特大学官网显示，该项目可衔接 research level 学习，也面向工业与学术研究职业路径，适合希望在 AI、软件、数据科学等方向进阶的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "计算机",
      "advanced computer science",
      "artificial intelligence",
      "software",
      "data science",
      "research",
    ],
    tags: ["英国", "计算机", "AI", "官方课程页"],
    overviewUrl:
      "https://www.manchester.ac.uk/study/masters/courses/list/21573/msc-advanced-computer-science/",
    admissionsUrl:
      "https://www.manchester.ac.uk/study/masters/courses/list/21573/msc-advanced-computer-science/",
    priority: 90,
  },
  {
    id: "bristol-computer-science-conversion-msc",
    schoolName: "University of Bristol",
    city: "Bristol",
    programName: "MSc Computer Science (Conversion)",
    discipline: "计算机 / AI",
    summary:
      "布里斯托大学官网显示，该 conversion 项目面向非计算机本科背景申请者，帮助学生系统建立计算机科学基础并转向软件、技术与计算相关职业。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "计算机转专业",
      "computer science conversion",
      "software",
      "programming",
      "computer science",
      "technology",
    ],
    tags: ["英国", "计算机", "转专业", "官方课程页"],
    overviewUrl:
      "https://www.bristol.ac.uk/study/postgraduate/taught/msc-computer-science-conversion/",
    admissionsUrl:
      "https://www.bristol.ac.uk/study/postgraduate/taught/msc-computer-science-conversion/",
    priority: 86,
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
      const nextName =
        current.sourceIds.includes(UK_SOURCE_ID) && current.name
          ? current.name
          : program.schoolName || current.name;
      map.set(matched.id, {
        ...current,
        name: nextName,
        nameZh:
          current.nameZh ||
          getStudyAbroadUniversityNameZh(nextName) ||
          getStudyAbroadUniversityNameZh(current.name),
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
  const existingProgramById = new Map(existingPrograms.map((item) => [item.id, item]));

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
    const current = existingProgramById.get(program.id) || nextPrograms.get(program.id);

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
      tuitionAmount: current?.tuitionAmount ?? "",
      tuitionCurrency: current?.tuitionCurrency ?? "",
      tuitionNotes: current?.tuitionNotes ?? "",
      overviewUrl: program.overviewUrl,
      admissionsUrl: program.admissionsUrl || program.overviewUrl,
      tuitionUrl: current?.tuitionUrl ?? program.overviewUrl,
      keywords: program.keywords,
      tags: program.tags,
      sourceIds: mergeSourceIds(current?.sourceIds ?? [], [UK_SOURCE_ID]),
      checkedAt: UK_SEED_CHECKED_AT,
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
