import { readFile } from "node:fs/promises";
import {
  readStudyAbroadCatalogPrograms,
  readStudyAbroadCatalogUniversities,
  writeStudyAbroadCatalogPrograms,
  writeStudyAbroadCatalogUniversities,
  type StudyAbroadCatalogProgram,
  type StudyAbroadCatalogUniversity,
} from "./study-abroad-catalog-store";
import { slugify } from "./text-fields";

type SecondaryImportOptions = {
  filePath: string;
  maxRecords?: number;
  state?: string;
  dryRun?: boolean;
};

const NCES_SOURCE_ID = "nces-ccd-public-school-universe";
const DEFAULT_CHECKED_AT = new Date().toISOString().slice(0, 10);

function parseCsvRows(input: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      if (row.some((item) => item.trim())) {
        rows.push(row);
      }
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  if (row.some((item) => item.trim())) {
    rows.push(row);
  }

  return rows;
}

function normalizeHeader(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function rowsToObjects(rows: string[][]) {
  const [headerRow, ...dataRows] = rows;
  const headers = (headerRow ?? []).map(normalizeHeader);

  return dataRows.map((row) => {
    const item: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      item[header] = String(row[index] ?? "").trim();
    });
    return item;
  });
}

function pick(row: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = row[normalizeHeader(key)];
    if (value) return value.trim();
  }
  return "";
}

function gradeNumber(value: string) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "PK" || normalized === "PREK" || normalized === "N") return -1;
  if (normalized === "KG" || normalized === "K" || normalized === "M") return 0;
  const numeric = Number.parseInt(normalized.replace(/^0+/, "") || "0", 10);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatGradeRange(low: string, high: string) {
  const cleanedLow = String(low || "").trim();
  const cleanedHigh = String(high || "").trim();
  if (cleanedLow && cleanedHigh) return `${cleanedLow}-${cleanedHigh}`;
  return cleanedHigh || cleanedLow || "";
}

function joinAddress(parts: string[]) {
  return parts.map((item) => String(item || "").trim()).filter(Boolean).join(", ");
}

function compactCoordinate(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(5) : "";
}

function isLikelyHighSchool(row: Record<string, string>) {
  const name = pick(row, ["SCH_NAME", "SCHNAM", "SCHOOL_NAME", "NAME"]);
  const lowGrade = pick(row, ["GSLO", "LOW_GRADE", "GLOFFERED", "LOWEST_GRADE"]);
  const highGrade = pick(row, ["GSHI", "HIGH_GRADE", "GHIGHEST", "HIGHEST_GRADE"]);
  const type = pick(row, ["SCH_TYPE", "SCHOOL_TYPE", "TYPE", "SCH_TYPE_TEXT"]);
  const high = gradeNumber(highGrade);
  const low = gradeNumber(lowGrade);
  const typeText = type.toLowerCase();

  if (typeText && /closed|inactive|future|not applicable/.test(typeText)) {
    return false;
  }

  if (high !== null && high >= 9 && (low === null || low <= 12)) {
    return true;
  }

  return /\b(high|secondary|senior high)\b/i.test(name);
}

function withHttps(url: string) {
  const cleaned = String(url || "").trim();
  if (!cleaned) return "";
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;
}

function websiteHost(url: string) {
  try {
    return new URL(withHttps(url)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function makeSchoolDetailUrl(ncesId: string) {
  return ncesId
    ? `https://nces.ed.gov/ccd/schoolsearch/school_detail.asp?ID=${encodeURIComponent(ncesId)}`
    : "https://nces.ed.gov/ccd/schoolsearch/";
}

function mergeSourceIds(current: string[], incoming: string[]) {
  return Array.from(new Set([...current, ...incoming].filter(Boolean)));
}

function buildSecondaryEntries(rows: Record<string, string>[], options: SecondaryImportOptions) {
  const stateFilter = String(options.state || "").trim().toUpperCase();
  const maxRecords = Math.max(0, Number(options.maxRecords) || 0);
  const universities: StudyAbroadCatalogUniversity[] = [];
  const programs: StudyAbroadCatalogProgram[] = [];

  for (const row of rows) {
    if (maxRecords && universities.length >= maxRecords) {
      break;
    }

    if (!isLikelyHighSchool(row)) {
      continue;
    }

    const name = pick(row, ["SCH_NAME", "SCHNAM", "SCHOOL_NAME", "NAME"]);
    const stateOrProvince = pick(row, ["LSTATE", "STATE", "ST", "STABR"]).toUpperCase();
    if (stateFilter && stateOrProvince !== stateFilter) {
      continue;
    }

    const city = pick(row, ["LCITY", "CITY", "MCITY"]);
    const ncesId = pick(row, ["NCESSCH", "NCESID", "SCHOOL_ID", "SCHID"]);
    if (!name || !stateOrProvince) {
      continue;
    }

    const street = pick(row, ["STREET", "LSTREET", "ADDRESS", "LOCATION_ADDRESS"]);
    const zip = pick(row, ["ZIP", "LZIP", "ZIPCODE", "POSTAL_CODE"]);
    const county = pick(row, ["NMCNTY", "COUNTY", "CNTYNAME", "COUNTY_NAME"]);
    const countyCode = pick(row, ["CNTY", "COUNTY_CODE"]);
    const locale = pick(row, ["LOCALE", "LOCALE_CODE"]);
    const schoolYear = pick(row, ["SCHOOLYEAR", "SCHOOL_YEAR"]);
    const cbsaName = pick(row, ["NMCBSA", "CBSA_NAME"]);
    const cbsaType = pick(row, ["CBSATYPE", "CBSA_TYPE"]);
    const latitude = compactCoordinate(pick(row, ["LAT", "LATITUDE", "Y"]));
    const longitude = compactCoordinate(pick(row, ["LON", "LONGITUDE", "X"]));
    const address = joinAddress([street, city, stateOrProvince, zip]);
    const website = withHttps(pick(row, ["WEBSITE", "WEB_SITE", "URL", "SCHOOL_URL"]));
    const overviewUrl = website || makeSchoolDetailUrl(ncesId);
    const gradeRange = formatGradeRange(
      pick(row, ["GSLO", "LOW_GRADE", "GLOFFERED", "LOWEST_GRADE"]),
      pick(row, ["GSHI", "HIGH_GRADE", "GHIGHEST", "HIGHEST_GRADE"])
    );
    const schoolType = pick(row, ["SCH_TYPE_TEXT", "SCHOOL_TYPE", "TYPE", "SCH_TYPE"]);
    const schoolId =
      slugify(`us-high-school-${ncesId || `${name}-${stateOrProvince}-${city}`}`) ||
      crypto.randomUUID().slice(0, 8);
    const programId = `${schoolId}-high-school`;

    universities.push({
      id: schoolId,
      name,
      nameZh: "",
      country: "美国",
      city,
      stateOrProvince,
      officialWebsite: overviewUrl,
      websiteDomain: websiteHost(overviewUrl),
      qsRank: null,
      qsRankingYear: null,
      rankingSource: "",
      sourceIds: [NCES_SOURCE_ID],
      updatedAt: DEFAULT_CHECKED_AT,
    });

    programs.push({
      id: programId,
      universityId: schoolId,
      schoolName: name,
      schoolNameZh: "",
      country: "美国",
      city,
      stateOrProvince,
      programName: `${name} 高中项目`,
      degree: "高中",
      discipline: "中学申请",
      summary: [
        `该高中条目来自 NCES Common Core of Data 公立学校目录，年级范围为 ${gradeRange || "未标注"}。`,
        address ? `地址：${address}。` : "",
        county ? `县/郡：${county}。` : "",
        cbsaName ? `城市统计区：${cbsaName}${cbsaType ? `（${cbsaType}）` : ""}。` : "",
        locale ? `NCES Locale：${locale}。` : "",
        latitude && longitude ? `坐标：${latitude}, ${longitude}。` : "",
        schoolYear ? `数据学年：${schoolYear}。` : "",
      ]
        .filter(Boolean)
        .join(""),
      duration: gradeRange ? `Grade ${gradeRange}` : "",
      intake: "",
      tuitionAmount: "",
      tuitionCurrency: "",
      tuitionNotes: "NCES CCD 是学校目录源，不提供项目学费；学费和寄宿信息需要后续从学校官网补齐。",
      overviewUrl,
      admissionsUrl: overviewUrl,
      tuitionUrl: "",
      keywords: [
        name,
        "美国高中",
        "高中",
        "中学",
        stateOrProvince,
        city,
        street,
        zip,
        county,
        countyCode,
        cbsaName,
        cbsaType,
        locale ? `Locale ${locale}` : "",
        schoolYear,
        latitude && longitude ? `${latitude},${longitude}` : "",
        gradeRange,
        ncesId,
      ].filter(Boolean),
      tags: [
        "美国",
        "高中",
        "NCES CCD",
        "官方学校目录",
        stateOrProvince,
        county,
        cbsaName,
        cbsaType,
        schoolType,
        locale ? `Locale ${locale}` : "",
        schoolYear ? `学年 ${schoolYear}` : "",
        gradeRange,
      ].filter(Boolean),
      sourceIds: [NCES_SOURCE_ID],
      checkedAt: DEFAULT_CHECKED_AT,
      priority: 45,
    });
  }

  return { universities, programs };
}

export async function syncUsSecondarySchoolCatalogFromFile(
  options: SecondaryImportOptions
) {
  if (!options.filePath) {
    throw new Error("请提供 NCES CCD 官方 CSV 文件路径，例如 --file=data/imports/nces-schools.csv");
  }

  const raw = await readFile(options.filePath, "utf8");
  const rows = rowsToObjects(parseCsvRows(raw));
  const imported = buildSecondaryEntries(rows, options);
  const [existingUniversities, existingPrograms] = await Promise.all([
    readStudyAbroadCatalogUniversities(),
    readStudyAbroadCatalogPrograms(),
  ]);

  const nextUniversities = new Map<string, StudyAbroadCatalogUniversity>();
  existingUniversities
    .filter((item) => !item.sourceIds.includes(NCES_SOURCE_ID))
    .forEach((item) => nextUniversities.set(item.id, item));

  imported.universities.forEach((item) => {
    const current = existingUniversities.find((candidate) => candidate.id === item.id);
    nextUniversities.set(item.id, {
      ...item,
      nameZh: current?.nameZh || item.nameZh,
      sourceIds: mergeSourceIds(current?.sourceIds ?? [], item.sourceIds),
    });
  });

  const nextPrograms = new Map<string, StudyAbroadCatalogProgram>();
  existingPrograms
    .filter((item) => !item.sourceIds.includes(NCES_SOURCE_ID))
    .forEach((item) => nextPrograms.set(item.id, item));
  imported.programs.forEach((item) => nextPrograms.set(item.id, item));

  if (!options.dryRun) {
    await Promise.all([
      writeStudyAbroadCatalogUniversities(Array.from(nextUniversities.values())),
      writeStudyAbroadCatalogPrograms(Array.from(nextPrograms.values())),
    ]);
  }

  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    parsedRowCount: rows.length,
    importedUniversityCount: imported.universities.length,
    importedProgramCount: imported.programs.length,
    sourceId: NCES_SOURCE_ID,
    message: options.dryRun
      ? `已预览 NCES 高中导入：${imported.universities.length} 所高中，${imported.programs.length} 个高中项目。`
      : `已导入 NCES 高中底库：${imported.universities.length} 所高中，${imported.programs.length} 个高中项目。`,
  };
}
