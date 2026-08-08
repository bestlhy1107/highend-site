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

const FOCUS_SEED_CHECKED_AT = "2026-05-06";
const FOCUS_SOURCE_ID = "focus-country-official-pages";
const DEPRECATED_FOCUS_SEED_PROGRAM_IDS = new Set(["unimelb-master-it"]);

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
    id: "cityu-msc-cs",
    country: "中国香港",
    schoolName: "City University of Hong Kong",
    city: "Hong Kong",
    programName: "Master of Science in Computer Science",
    discipline: "计算机 / AI",
    summary:
      "香港城市大学官网显示，该项目面向希望系统进阶 computer science 与 software systems 的申请者，课程覆盖算法、系统、数据与智能计算方向。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "computer science",
      "计算机科学",
      "software systems",
      "algorithms",
      "data",
      "intelligent computing",
    ],
    tags: ["中国香港", "计算机", "官方课程页"],
    overviewUrl: "https://www.cs.cityu.edu.hk/en/academic-programmes/msc-computer-science/aims",
    admissionsUrl: "https://www.cs.cityu.edu.hk/academic-programmes/msc-computer-science/admissions",
    priority: 88,
  },
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
    id: "polyu-msc-dsa",
    country: "中国香港",
    schoolName: "The Hong Kong Polytechnic University",
    city: "Hong Kong",
    programName: "Master of Science in Data Science and Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "香港理工大学官网显示，该项目围绕 data science、analytics methods 与 business applications，强调把统计、编程与数据决策结合到真实应用中。",
    duration: "1.5 年",
    intake: "9 月",
    keywords: [
      "data science",
      "analytics",
      "数据科学",
      "统计",
      "programming",
      "business applications",
    ],
    tags: ["中国香港", "数据科学", "官方课程页"],
    overviewUrl: "https://www.polyu.edu.hk/dsai/study/tpg/mscdsa-/?sc_lang=en",
    admissionsUrl: "https://www.polyu.edu.hk/dsai/study/tpg/mscdsa-/?sc_lang=en",
    priority: 87,
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
    id: "smu-mitb",
    country: "新加坡",
    schoolName: "Singapore Management University",
    city: "Singapore",
    programName: "Master of IT in Business",
    discipline: "商业分析 / 数据",
    summary:
      "SMU 官网显示，MITB 以 analytics、digital transformation 与 AI-enabled business applications 为核心，适合希望站在 business 与 technology 交叉点发展的申请者。",
    duration: "12-18 个月",
    intake: "8 月",
    keywords: [
      "IT in business",
      "business analytics",
      "data analytics",
      "digital transformation",
      "artificial intelligence",
      "fintech",
    ],
    tags: ["新加坡", "商业分析", "数字化", "官方课程页"],
    overviewUrl: "https://masters.smu.edu.sg/programme/master-of-it-in-business",
    admissionsUrl: "https://masters.smu.edu.sg/programme/master-of-it-in-business",
    priority: 88,
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
    id: "uvic-mads",
    country: "加拿大",
    schoolName: "University of Victoria",
    city: "Victoria",
    programName: "Master of Engineering in Applied Data Science",
    discipline: "商业分析 / 数据",
    summary:
      "维多利亚大学官网显示，Applied Data Science 项目结合 statistics、machine learning 与 applied computing，强调以工程化方式解决真实数据问题。",
    duration: "16 个月",
    intake: "9 月",
    keywords: [
      "applied data science",
      "数据科学",
      "machine learning",
      "statistics",
      "applied computing",
      "data engineering",
    ],
    tags: ["加拿大", "数据科学", "官方课程页"],
    overviewUrl: "https://www.uvic.ca/ecs/programs/professional-programs/meng-mads/index.php",
    admissionsUrl: "https://www.uvic.ca/ecs/programs/professional-programs/meng-mads/index.php",
    priority: 84,
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
    admissionsUrl: "https://www.uwo.ca/mda/admissions/index.html",
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
    id: "uts-mdsi",
    country: "澳大利亚",
    schoolName: "University of Technology Sydney",
    city: "Sydney",
    programName: "Master of Data Science and Innovation",
    discipline: "商业分析 / 数据",
    summary:
      "悉尼科技大学官网显示，该项目强调 data science、analytics、innovation 与商业应用的结合，适合希望在 industry-facing data roles 中发展的申请者。",
    duration: "2 年",
    intake: "2 月 / 8 月",
    keywords: [
      "data science",
      "innovation",
      "analytics",
      "数据科学",
      "business applications",
      "machine learning",
    ],
    tags: ["澳大利亚", "数据科学", "创新", "官方课程页"],
    overviewUrl: "https://www.uts.edu.au/courses/master-of-data-science-and-innovation",
    admissionsUrl: "https://www.uts.edu.au/courses/master-of-data-science-and-innovation",
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
  {
    id: "hkust-big-data-technology-msc",
    country: "中国香港",
    schoolName: "The Hong Kong University of Science and Technology",
    city: "Hong Kong",
    programName: "MSc in Big Data Technology",
    discipline: "计算机 / AI",
    summary:
      "港科大官网显示，该项目由 Computer Science and Engineering 与 Mathematics 合办，聚焦 big data、data mining、cloud computing、AI 与大规模数据处理能力。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "big data",
      "大数据",
      "data mining",
      "cloud computing",
      "artificial intelligence",
      "computer science",
    ],
    tags: ["中国香港", "大数据", "计算机", "官方课程页"],
    overviewUrl: "https://prog-crs.hkust.edu.hk/pgprog/2026-27/msc-bdt",
    admissionsUrl: "https://prog-crs.hkust.edu.hk/pgprog/2026-27/msc-bdt",
    priority: 90,
  },
  {
    id: "cuhk-computer-science-msc",
    country: "中国香港",
    schoolName: "The Chinese University of Hong Kong",
    city: "Hong Kong",
    programName: "MSc in Computer Science",
    discipline: "计算机 / AI",
    summary:
      "港中文工程学院官网显示，该项目为希望强化 computer science 训练的申请者提供系统课程，覆盖软件、系统、AI、数据与理论计算相关方向。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "computer science",
      "计算机科学",
      "software",
      "artificial intelligence",
      "data",
      "systems",
    ],
    tags: ["中国香港", "计算机", "官方课程页"],
    overviewUrl: "https://www.cse.cuhk.edu.hk/academics/postgraduate/msc-in-computer-science/",
    admissionsUrl: "https://www.cse.cuhk.edu.hk/academics/postgraduate/msc-in-computer-science/",
    priority: 88,
  },
  {
    id: "hku-marketing-msc",
    country: "中国香港",
    schoolName: "The University of Hong Kong",
    city: "Hong Kong",
    programName: "Master of Science in Marketing",
    discipline: "市场营销 / 传媒",
    summary:
      "港大商学院官网显示，该项目结合 marketing analytics、digital marketing 与品牌战略，适合希望进入市场、品牌、咨询或数字增长方向的申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "marketing",
      "市场营销",
      "digital marketing",
      "marketing analytics",
      "brand",
      "consumer",
    ],
    tags: ["中国香港", "市场营销", "数字营销", "官方课程页"],
    overviewUrl: "https://masters.hkubs.hku.hk/programmes/master-of-science-in-marketing",
    admissionsUrl: "https://masters.hkubs.hku.hk/programmes/master-of-science-in-marketing/admissions",
    priority: 87,
  },
  {
    id: "nus-master-computing-ai",
    country: "新加坡",
    schoolName: "National University of Singapore",
    city: "Singapore",
    programName: "Master of Computing - Artificial Intelligence",
    discipline: "计算机 / AI",
    summary:
      "NUS School of Computing 官网显示，Master of Computing 可选择 Artificial Intelligence specialisation，围绕 AI 原理、智能系统、机器学习与计算实践展开。",
    duration: "1.5-2 年",
    intake: "8 月 / 1 月",
    keywords: [
      "artificial intelligence",
      "人工智能",
      "master of computing",
      "machine learning",
      "intelligent systems",
      "computer science",
    ],
    tags: ["新加坡", "人工智能", "计算机", "官方课程页"],
    overviewUrl: "https://www.comp.nus.edu.sg/programmes/pg/mcomp/",
    admissionsUrl: "https://www.comp.nus.edu.sg/programmes/pg/mcomp/admissions/",
    priority: 93,
  },
  {
    id: "nus-master-computing-infosec",
    country: "新加坡",
    schoolName: "National University of Singapore",
    city: "Singapore",
    programName: "Master of Computing - Infocomm Security",
    discipline: "计算机 / AI",
    summary:
      "NUS School of Computing 官网显示，Master of Computing 提供 Infocomm Security specialisation，适合希望进入网络安全、系统安全与信息安全技术路径的申请者。",
    duration: "1.5-2 年",
    intake: "8 月 / 1 月",
    keywords: [
      "cyber security",
      "infocomm security",
      "信息安全",
      "network security",
      "systems security",
      "computer science",
    ],
    tags: ["新加坡", "网络安全", "计算机", "官方课程页"],
    overviewUrl: "https://www.comp.nus.edu.sg/programmes/pg/mcomp/",
    admissionsUrl: "https://www.comp.nus.edu.sg/programmes/pg/mcomp/admissions/",
    priority: 90,
  },
  {
    id: "nus-msc-finance",
    country: "新加坡",
    schoolName: "National University of Singapore",
    city: "Singapore",
    programName: "MSc in Finance",
    discipline: "金融",
    summary:
      "NUS Business School 官网显示，MSc in Finance 以金融理论、量化技能与实际市场应用为核心，面向希望进入金融机构、企业金融或投资相关岗位的申请者。",
    duration: "1 年",
    intake: "8 月",
    keywords: [
      "finance",
      "金融",
      "investment",
      "corporate finance",
      "financial markets",
      "quantitative finance",
    ],
    tags: ["新加坡", "金融", "官方课程页"],
    overviewUrl: "https://mscfin.nus.edu.sg/",
    admissionsUrl: "https://mscfin.nus.edu.sg/admissions/",
    priority: 91,
  },
  {
    id: "ntu-cyber-security-msc",
    country: "新加坡",
    schoolName: "Nanyang Technological University",
    city: "Singapore",
    programName: "MSc in Cyber Security",
    discipline: "计算机 / AI",
    summary:
      "南洋理工官网显示，该项目面向希望掌握 cyber security 理论与实践能力的申请者，覆盖安全工程、网络、系统与应用安全相关训练。",
    duration: "1 年",
    intake: "8 月",
    keywords: [
      "cyber security",
      "网络安全",
      "information security",
      "systems security",
      "network security",
      "computer science",
    ],
    tags: ["新加坡", "网络安全", "计算机", "官方课程页"],
    overviewUrl:
      "https://www.ntu.edu.sg/education/graduate-programme/master-of-science-in-cyber-security",
    admissionsUrl:
      "https://www.ntu.edu.sg/education/graduate-programme/master-of-science-in-cyber-security",
    priority: 88,
  },
  {
    id: "smu-computing-msc",
    country: "新加坡",
    schoolName: "Singapore Management University",
    city: "Singapore",
    programName: "MSc in Computing",
    discipline: "计算机 / AI",
    summary:
      "SMU 官网显示，MSc in Computing 面向希望强化软件工程、AI、数据与计算系统能力的申请者，结合技术深度与业务应用语境。",
    duration: "1 年",
    intake: "8 月 / 1 月",
    keywords: [
      "computing",
      "计算机",
      "software engineering",
      "artificial intelligence",
      "data",
      "computer systems",
    ],
    tags: ["新加坡", "计算机", "软件", "官方课程页"],
    overviewUrl: "https://masters.smu.edu.sg/programme/master-of-science-in-computing",
    admissionsUrl: "https://masters.smu.edu.sg/programme/master-of-science-in-computing/admissions",
    priority: 86,
  },
  {
    id: "sutd-security-by-design-msc",
    country: "新加坡",
    schoolName: "Singapore University of Technology and Design",
    city: "Singapore",
    programName: "Master of Science in Security by Design",
    discipline: "计算机 / AI",
    summary:
      "SUTD 官网显示，Security by Design 项目聚焦 cyber security、secure systems 与设计导向的安全工程，适合网络安全和系统安全方向申请者。",
    duration: "1 年",
    intake: "9 月",
    keywords: [
      "cyber security",
      "security by design",
      "secure systems",
      "网络安全",
      "systems security",
      "computing",
    ],
    tags: ["新加坡", "网络安全", "系统安全", "官方课程页"],
    overviewUrl: "https://www.sutd.edu.sg/Admissions/Graduate/MSc-Security-by-Design",
    admissionsUrl: "https://www.sutd.edu.sg/Admissions/Graduate/MSc-Security-by-Design",
    priority: 84,
  },
  {
    id: "unimelb-master-finance",
    country: "澳大利亚",
    schoolName: "The University of Melbourne",
    city: "Melbourne",
    programName: "Master of Finance",
    discipline: "金融",
    summary:
      "墨尔本大学官网显示，Master of Finance 面向希望深化金融市场、投资、资产定价与企业金融能力的申请者，并为金融职业路径提供专业训练。",
    duration: "1.5 年",
    intake: "2 月 / 7 月",
    keywords: [
      "finance",
      "金融",
      "investment",
      "asset pricing",
      "corporate finance",
      "financial markets",
    ],
    tags: ["澳大利亚", "金融", "官方课程页"],
    overviewUrl: "https://study.unimelb.edu.au/find/courses/graduate/master-of-finance/",
    admissionsUrl: "https://study.unimelb.edu.au/find/courses/graduate/master-of-finance/",
    priority: 91,
  },
  {
    id: "unsw-master-finance",
    country: "澳大利亚",
    schoolName: "UNSW Sydney",
    city: "Sydney",
    programName: "Master of Finance",
    discipline: "金融",
    summary:
      "UNSW 官网显示，Master of Finance 面向具有金融背景的申请者，提供投资、金融科技、企业金融与金融分析相关进阶训练。",
    duration: "1 年",
    intake: "2 月 / 6 月 / 9 月",
    keywords: [
      "finance",
      "金融",
      "investment",
      "fintech",
      "corporate finance",
      "financial analysis",
    ],
    tags: ["澳大利亚", "金融", "官方课程页"],
    overviewUrl:
      "https://www.unsw.edu.au/study/postgraduate/master-of-finance?studentType=international",
    admissionsUrl:
      "https://www.unsw.edu.au/study/postgraduate/master-of-finance?studentType=international",
    priority: 89,
  },
  {
    id: "sydney-master-computer-science",
    country: "澳大利亚",
    schoolName: "The University of Sydney",
    city: "Sydney",
    programName: "Master of Computer Science",
    discipline: "计算机 / AI",
    summary:
      "悉尼大学官网显示，Master of Computer Science 面向希望在计算机科学、软件工程、AI 与数据技术方向深入发展的申请者，提供专业方向选择。",
    duration: "2 年",
    intake: "2 月 / 8 月",
    keywords: [
      "computer science",
      "计算机科学",
      "software engineering",
      "artificial intelligence",
      "data",
      "technology",
    ],
    tags: ["澳大利亚", "计算机", "AI", "官方课程页"],
    overviewUrl:
      "https://www.sydney.edu.au/courses/courses/pc/master-of-computer-science.html",
    admissionsUrl:
      "https://www.sydney.edu.au/courses/courses/pc/master-of-computer-science.html",
    priority: 89,
  },
  {
    id: "anu-machine-learning-computer-vision-masters",
    country: "澳大利亚",
    schoolName: "Australian National University",
    city: "Canberra",
    programName: "Master of Machine Learning and Computer Vision",
    discipline: "计算机 / AI",
    summary:
      "澳国立大学官网显示，该项目聚焦 machine learning、computer vision 与 AI 技术应用，适合希望在智能系统、视觉计算和数据建模方向深入的申请者。",
    duration: "2 年",
    intake: "2 月 / 7 月",
    keywords: [
      "machine learning",
      "computer vision",
      "人工智能",
      "ai",
      "data modelling",
      "intelligent systems",
    ],
    tags: ["澳大利亚", "机器学习", "计算机视觉", "官方课程页"],
    overviewUrl:
      "https://programsandcourses.anu.edu.au/program/MMLCV",
    admissionsUrl:
      "https://programsandcourses.anu.edu.au/program/MMLCV",
    priority: 88,
  },
  {
    id: "monash-information-technology-master",
    country: "澳大利亚",
    schoolName: "Monash University",
    city: "Melbourne",
    programName: "Master of Information Technology",
    discipline: "计算机 / AI",
    summary:
      "蒙纳士大学官网显示，Master of Information Technology 覆盖 software engineering、cybersecurity、data science 与 IT 系统能力，适合不同技术背景的申请者进阶。",
    duration: "1.5-2 年",
    intake: "2 月 / 7 月",
    keywords: [
      "information technology",
      "信息技术",
      "software engineering",
      "cybersecurity",
      "data science",
      "computer science",
    ],
    tags: ["澳大利亚", "信息技术", "计算机", "官方课程页"],
    overviewUrl:
      "https://www.monash.edu/study/courses/find-a-course/information-technology-c6001",
    admissionsUrl:
      "https://www.monash.edu/study/courses/find-a-course/information-technology-c6001",
    priority: 87,
  },
  {
    id: "sydney-media-practice-master",
    country: "澳大利亚",
    schoolName: "The University of Sydney",
    city: "Sydney",
    programName: "Master of Media Practice",
    discipline: "市场营销 / 传媒",
    summary:
      "悉尼大学官网显示，Master of Media Practice 聚焦 journalism、public relations、digital media 与 professional communication，适合传媒与传播实践方向申请者。",
    duration: "1-1.5 年",
    intake: "2 月 / 8 月",
    keywords: [
      "media",
      "传媒",
      "journalism",
      "public relations",
      "digital media",
      "communication",
    ],
    tags: ["澳大利亚", "传媒", "传播", "官方课程页"],
    overviewUrl: "https://www.sydney.edu.au/courses/courses/pc/master-of-media-practice.html",
    admissionsUrl: "https://www.sydney.edu.au/courses/courses/pc/master-of-media-practice.html",
    priority: 87,
  },
  {
    id: "monash-communications-media-studies-master",
    country: "澳大利亚",
    schoolName: "Monash University",
    city: "Melbourne",
    programName: "Master of Communications and Media Studies",
    discipline: "市场营销 / 传媒",
    summary:
      "蒙纳士大学官网显示，该项目关注 global media、digital communications 与 communication research，适合希望进入传播、媒体、政策或内容策略方向的申请者。",
    duration: "1-2 年",
    intake: "2 月 / 7 月",
    keywords: [
      "communications",
      "media studies",
      "传媒",
      "digital communications",
      "global media",
      "communication research",
    ],
    tags: ["澳大利亚", "传媒", "传播", "官方课程页"],
    overviewUrl:
      "https://www.monash.edu/study/courses/find-a-course/communications-and-media-studies-a6004",
    admissionsUrl:
      "https://www.monash.edu/study/courses/find-a-course/communications-and-media-studies-a6004",
    priority: 86,
  },
  {
    id: "ubc-master-data-science",
    country: "加拿大",
    schoolName: "University of British Columbia",
    city: "Vancouver",
    programName: "Master of Data Science",
    discipline: "商业分析 / 数据",
    summary:
      "UBC 官网显示，Master of Data Science 是紧凑型专业硕士项目，强调 statistics、machine learning、data wrangling、visualization 与真实项目实践。",
    duration: "10 个月",
    intake: "9 月",
    keywords: [
      "data science",
      "数据科学",
      "machine learning",
      "statistics",
      "visualization",
      "data wrangling",
    ],
    tags: ["加拿大", "数据科学", "官方课程页"],
    overviewUrl: "https://masterdatascience.ubc.ca/programs/vancouver",
    admissionsUrl: "https://masterdatascience.ubc.ca/admissions",
    priority: 88,
  },
  {
    id: "mcgill-management-analytics-mma",
    country: "加拿大",
    schoolName: "McGill University",
    city: "Montreal",
    programName: "Master of Management in Analytics",
    discipline: "商业分析 / 数据",
    summary:
      "麦吉尔大学官网显示，MMA 项目结合 analytics、管理与实践项目，帮助学生将统计建模、数据工具和商业判断转化为管理决策。",
    duration: "1 年",
    intake: "夏季",
    keywords: [
      "management analytics",
      "business analytics",
      "商业分析",
      "data analytics",
      "management",
      "decision making",
    ],
    tags: ["加拿大", "商业分析", "数据", "官方课程页"],
    overviewUrl:
      "https://www.mcgill.ca/desautels/programs/mm-analytics",
    admissionsUrl:
      "https://www.mcgill.ca/desautels/programs/mm-analytics/admissions",
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
  DEPRECATED_FOCUS_SEED_PROGRAM_IDS.forEach((id) => nextPrograms.delete(id));

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
