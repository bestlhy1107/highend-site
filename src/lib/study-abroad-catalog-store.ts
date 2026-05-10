import {
  getJsonArrayFileVersion,
  invalidateJsonArrayFileCache,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import {
  CANONICAL_DISCIPLINE_OVERRIDES,
  MAJOR_QUERY_ALIASES,
  MAJOR_FAMILIES,
  SPECIALIZATION_QUERY_ALIASES,
  SPECIALIZATION_TO_MAJOR,
  STUDY_ABROAD_MAJOR_OPTIONS,
  STUDY_ABROAD_MAJOR_SPECIALIZATIONS,
  STUDY_ABROAD_PROGRAMS,
  STUDY_ABROAD_DATA_UPDATED_AT,
  type StudyAbroadProgram,
} from "./study-abroad-programs";
import { getStudyAbroadUniversityNameZh } from "./study-abroad-university-names";
import { slugify } from "./text-fields";

export type StudyAbroadCatalogSource = {
  id: string;
  name: string;
  scope: "global" | "country";
  category: "official" | "commercial" | "open-data";
  accessModel: "api" | "open-data" | "licensed" | "manual";
  status: "ready" | "pilot" | "needs-license" | "research";
  regions: string[];
  fieldCoverage: string[];
  recommendedUse: string;
  url: string;
  notes: string;
  priority: number;
  reviewedAt: string;
};

export type StudyAbroadCatalogUniversity = {
  id: string;
  name: string;
  nameZh: string;
  country: string;
  city: string;
  stateOrProvince: string;
  officialWebsite: string;
  websiteDomain: string;
  qsRank: number | null;
  qsRankingYear: number | null;
  rankingSource: string;
  sourceIds: string[];
  updatedAt: string;
};

export type StudyAbroadCatalogProgram = {
  id: string;
  universityId: string;
  schoolName: string;
  schoolNameZh: string;
  country: string;
  city: string;
  stateOrProvince: string;
  programName: string;
  degree: "本科" | "硕士" | "博士";
  discipline: string;
  summary: string;
  duration?: string;
  intake?: string;
  tuitionAmount: string;
  tuitionCurrency: string;
  tuitionNotes: string;
  overviewUrl: string;
  admissionsUrl?: string;
  tuitionUrl?: string;
  keywords: string[];
  tags: string[];
  sourceIds: string[];
  checkedAt: string;
  priority: number;
  admissionsSnapshot?: StudyAbroadCatalogAdmissionsSnapshot | null;
};

export type StudyAbroadFinderProgram = StudyAbroadCatalogProgram & {
  officialWebsite: string;
  websiteDomain: string;
  qsRank: number | null;
  qsRankingYear: number | null;
  rankingSource: string;
};

export type StudyAbroadCatalogAdmissionsSnapshot = {
  extractedAt: string;
  extractionStatus: "ok" | "partial" | "unavailable";
  gpaMin: number | null;
  gpaScale: string;
  ieltsMin: number | null;
  toeflMin: number | null;
  duolingoMin: number | null;
  pteMin: number | null;
  greStatus: "required" | "recommended" | "optional" | "unknown";
  gmatStatus: "required" | "recommended" | "optional" | "unknown";
  workExperienceYears: number | null;
};

export type StudyAbroadAdmissionsCoverageGroup = {
  label: string;
  totalPrograms: number;
  syncedPrograms: number;
  structuredPrograms: number;
  completePrograms: number;
  missingPrograms: number;
};

const SOURCE_FILE = "study-abroad-sources.json";
const UNIVERSITY_FILE = "study-abroad-universities.json";
const PROGRAM_FILE = "study-abroad-programs.json";

const derivedCatalogCache = new Map<
  string,
  {
    version: string;
    promise: Promise<unknown>;
  }
>();
const canonicalDisciplineOverrideMap = new Map(
  Object.entries(CANONICAL_DISCIPLINE_OVERRIDES).map(([label, major]) => [
    normalizeLookupText(label),
    major,
  ])
);
const specializationToMajorMap = new Map(
  Object.entries(SPECIALIZATION_TO_MAJOR).map(([specialization, major]) => [
    normalizeLookupText(specialization),
    major,
  ])
);

function readDerivedCatalogCache<T>(key: string, version: string, load: () => Promise<T>) {
  const cached = derivedCatalogCache.get(key);
  if (cached && cached.version === version) {
    return cached.promise as Promise<T>;
  }

  const nextPromise = load().catch((error) => {
    derivedCatalogCache.delete(key);
    throw error;
  });
  derivedCatalogCache.set(key, {
    version,
    promise: nextPromise as Promise<unknown>,
  });
  return nextPromise;
}

function invalidateStudyAbroadCatalogDerivedCache() {
  derivedCatalogCache.clear();
}

function normalizeLookupText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisciplineLabel(input: {
  discipline: string;
  programName?: string;
  summary?: string;
  keywords?: string[];
  tags?: string[];
}) {
  const discipline = String(input.discipline ?? "").trim();
  if (!discipline) return "";

  if (STUDY_ABROAD_MAJOR_OPTIONS.some((option) => option === discipline)) {
    return discipline;
  }

  const normalizedDiscipline = normalizeLookupText(discipline);
  const directOverride = canonicalDisciplineOverrideMap.get(normalizedDiscipline);
  if (directOverride) {
    return directOverride;
  }

  const directSpecializationMajor = specializationToMajorMap.get(normalizedDiscipline);
  if (directSpecializationMajor) {
    return directSpecializationMajor;
  }

  const searchText = normalizeLookupText(
    [
      discipline,
      input.programName,
      input.summary,
      ...(input.keywords ?? []),
      ...(input.tags ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );

  const scoreMap = new Map<string, number>();

  const addScore = (major: string, score: number) => {
    if (!major || score <= 0) return;
    scoreMap.set(major, (scoreMap.get(major) ?? 0) + score);
  };

  const scoreAliases = (
    major: string,
    aliases: string[],
    options: { exactBonus?: number; longBonus?: number; mediumBonus?: number; shortBonus?: number } = {}
  ) => {
    aliases.forEach((alias) => {
      const normalizedAlias = normalizeLookupText(alias);
      if (!normalizedAlias) return;

      if (normalizedDiscipline === normalizedAlias) {
        addScore(major, options.exactBonus ?? 8);
      }

      if (!searchText.includes(normalizedAlias)) {
        return;
      }

      if (normalizedAlias.length >= 10) {
        addScore(major, options.longBonus ?? 4);
      } else if (normalizedAlias.length >= 5) {
        addScore(major, options.mediumBonus ?? 3);
      } else {
        addScore(major, options.shortBonus ?? 2);
      }
    });
  };

  Object.entries(STUDY_ABROAD_MAJOR_SPECIALIZATIONS).forEach(([major, specializations]) => {
    scoreAliases(major, specializations, { exactBonus: 9, longBonus: 4, mediumBonus: 3, shortBonus: 2 });
  });

  Object.entries(SPECIALIZATION_QUERY_ALIASES).forEach(([specialization, aliases]) => {
    const major = SPECIALIZATION_TO_MAJOR[specialization];
    if (!major) return;
    scoreAliases(major, [specialization, ...aliases], {
      exactBonus: 9,
      longBonus: 4,
      mediumBonus: 3,
      shortBonus: 2,
    });
  });

  Object.entries(MAJOR_QUERY_ALIASES).forEach(([major, aliases]) => {
    scoreAliases(major, [major, ...aliases], {
      exactBonus: 8,
      longBonus: 4,
      mediumBonus: 3,
      shortBonus: 2,
    });
  });

  Object.entries(MAJOR_FAMILIES).forEach(([major, aliases]) => {
    scoreAliases(major, [major, ...aliases], {
      exactBonus: 7,
      longBonus: 3,
      mediumBonus: 2,
      shortBonus: 1,
    });
  });

  let bestLabel = discipline;
  let bestScore = 0;

  scoreMap.forEach((score, label) => {
    if (score > bestScore) {
      bestScore = score;
      bestLabel = label;
    }
  });

  return bestScore >= 3 ? bestLabel : discipline;
}

function normalizeStringArray(input: unknown) {
  return Array.isArray(input)
    ? input.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
}

function normalizePositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAdmissionsSnapshot(
  input: Partial<StudyAbroadCatalogAdmissionsSnapshot> | null | undefined
) {
  if (!input) return null;

  const extractedAt = String(input.extractedAt ?? "").trim();
  if (!extractedAt) {
    return null;
  }

  return {
    extractedAt,
    extractionStatus:
      input.extractionStatus === "ok" ||
      input.extractionStatus === "partial" ||
      input.extractionStatus === "unavailable"
        ? input.extractionStatus
        : "unavailable",
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
  } satisfies StudyAbroadCatalogAdmissionsSnapshot;
}

function normalizeSource(input: Partial<StudyAbroadCatalogSource>): StudyAbroadCatalogSource {
  return {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "").trim(),
    scope: input.scope === "country" ? "country" : "global",
    category:
      input.category === "commercial" || input.category === "open-data"
        ? input.category
        : "official",
    accessModel:
      input.accessModel === "api" ||
      input.accessModel === "open-data" ||
      input.accessModel === "licensed"
        ? input.accessModel
        : "manual",
    status:
      input.status === "ready" ||
      input.status === "pilot" ||
      input.status === "needs-license"
        ? input.status
        : "research",
    regions: normalizeStringArray(input.regions),
    fieldCoverage: normalizeStringArray(input.fieldCoverage),
    recommendedUse: String(input.recommendedUse ?? "").trim(),
    url: String(input.url ?? "").trim(),
    notes: String(input.notes ?? "").trim(),
    priority: Number(input.priority ?? 999),
    reviewedAt: String(input.reviewedAt ?? STUDY_ABROAD_DATA_UPDATED_AT).trim(),
  };
}

function isValidSource(item: StudyAbroadCatalogSource) {
  return Boolean(item.id && item.name && item.url);
}

function compareByPriority(a: { priority: number }, b: { priority: number }) {
  return a.priority - b.priority;
}

function universityIdFor(program: Pick<StudyAbroadProgram, "schoolName">) {
  return slugify(program.schoolName) || crypto.randomUUID().slice(0, 8);
}

function safeOrigin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUniversity(
  input: Partial<StudyAbroadCatalogUniversity>
): StudyAbroadCatalogUniversity {
  return {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "").trim(),
    nameZh: String(
      input.nameZh ?? getStudyAbroadUniversityNameZh(String(input.name ?? ""))
    ).trim(),
    country: String(input.country ?? "").trim(),
    city: String(input.city ?? "").trim(),
    stateOrProvince: String(input.stateOrProvince ?? "").trim(),
    officialWebsite: String(input.officialWebsite ?? "").trim(),
    websiteDomain: String(input.websiteDomain ?? "").trim(),
    qsRank: Number.isFinite(Number(input.qsRank)) ? Number(input.qsRank) : null,
    qsRankingYear: Number.isFinite(Number(input.qsRankingYear))
      ? Number(input.qsRankingYear)
      : null,
    rankingSource: String(input.rankingSource ?? "").trim(),
    sourceIds: normalizeStringArray(input.sourceIds),
    updatedAt: String(input.updatedAt ?? STUDY_ABROAD_DATA_UPDATED_AT).trim(),
  };
}

function normalizeProgram(
  input: Partial<StudyAbroadCatalogProgram>
): StudyAbroadCatalogProgram {
  const rawDegree = String(input.degree ?? "").trim();
  const normalizedDegree =
    rawDegree === "本科" || rawDegree === "博士" ? rawDegree : "硕士";
  const programName = String(input.programName ?? "").trim();
  const normalizedDiscipline =
    rawDegree === "MBA" || /(^|\s)MBA(\s|$)/i.test(programName)
      ? "MBA"
      : normalizeDisciplineLabel({
          discipline: String(input.discipline ?? "").trim(),
          programName,
          summary: String(input.summary ?? "").trim(),
          keywords: normalizeStringArray(input.keywords),
          tags: normalizeStringArray(input.tags),
        });

  return {
    id: String(input.id ?? "").trim(),
    universityId: String(input.universityId ?? "").trim(),
    schoolName: String(input.schoolName ?? "").trim(),
    schoolNameZh: String(
      input.schoolNameZh ?? getStudyAbroadUniversityNameZh(String(input.schoolName ?? ""))
    ).trim(),
    country: String(input.country ?? "").trim(),
    city: String(input.city ?? "").trim(),
    stateOrProvince: String(input.stateOrProvince ?? "").trim(),
    programName: String(input.programName ?? "").trim(),
    degree: normalizedDegree as "本科" | "硕士" | "博士",
    discipline: normalizedDiscipline,
    summary: String(input.summary ?? "").trim(),
    duration: String(input.duration ?? "").trim(),
    intake: String(input.intake ?? "").trim(),
    tuitionAmount: String(input.tuitionAmount ?? "").trim(),
    tuitionCurrency: String(input.tuitionCurrency ?? "").trim(),
    tuitionNotes: String(input.tuitionNotes ?? "").trim(),
    overviewUrl: String(input.overviewUrl ?? "").trim(),
    admissionsUrl: String(input.admissionsUrl ?? "").trim(),
    tuitionUrl: String(input.tuitionUrl ?? "").trim(),
    keywords: normalizeStringArray(input.keywords),
    tags: normalizeStringArray(input.tags),
    sourceIds: normalizeStringArray(input.sourceIds),
    checkedAt: String(input.checkedAt ?? STUDY_ABROAD_DATA_UPDATED_AT).trim(),
    priority: Number(input.priority ?? 999),
    admissionsSnapshot: normalizeAdmissionsSnapshot(input.admissionsSnapshot),
  };
}

function isValidUniversity(item: StudyAbroadCatalogUniversity) {
  return Boolean(item.id && item.name && item.country);
}

function isValidProgram(item: StudyAbroadCatalogProgram) {
  return Boolean(item.id && item.universityId && item.programName && item.overviewUrl);
}

function compareUniversities(
  a: StudyAbroadCatalogUniversity,
  b: StudyAbroadCatalogUniversity
) {
  return `${a.country}-${a.name}`.localeCompare(`${b.country}-${b.name}`, "zh-CN");
}

function comparePrograms(a: StudyAbroadCatalogProgram, b: StudyAbroadCatalogProgram) {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }

  return `${a.country}-${a.schoolName}-${a.programName}`.localeCompare(
    `${b.country}-${b.schoolName}-${b.programName}`,
    "zh-CN"
  );
}

function compareFinderPrograms(a: StudyAbroadFinderProgram, b: StudyAbroadFinderProgram) {
  if (a.priority !== b.priority) {
    return b.priority - a.priority;
  }

  const leftRank = Number.isFinite(a.qsRank ?? NaN) ? (a.qsRank ?? 999999) : 999999;
  const rightRank = Number.isFinite(b.qsRank ?? NaN) ? (b.qsRank ?? 999999) : 999999;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return comparePrograms(a, b);
}

function buildFallbackUniversities() {
  const map = new Map<string, StudyAbroadCatalogUniversity>();

  STUDY_ABROAD_PROGRAMS.forEach((program) => {
    const id = universityIdFor(program);

    if (map.has(id)) {
      return;
    }

    map.set(
      id,
      normalizeUniversity({
        id,
        name: program.schoolName,
        country: program.country,
        city: program.city,
        stateOrProvince: "",
        officialWebsite: safeOrigin(program.overviewUrl),
        websiteDomain: safeHost(program.overviewUrl),
        qsRank: null,
        qsRankingYear: 2026,
        rankingSource: "待接入",
        sourceIds: ["curated-manual"],
        updatedAt: program.checkedAt,
      })
    );
  });

  return Array.from(map.values()).sort(compareUniversities);
}

function buildFallbackPrograms() {
  return STUDY_ABROAD_PROGRAMS.map((program) =>
    normalizeProgram({
      id: program.id,
      universityId: universityIdFor(program),
      schoolName: program.schoolName,
      country: program.country,
      city: program.city,
      stateOrProvince: "",
      programName: program.programName,
      degree: program.degree,
      discipline: program.discipline,
      summary: program.summary,
      duration: program.duration,
      intake: program.intake,
      tuitionAmount: "",
      tuitionCurrency: "",
      tuitionNotes: "",
      overviewUrl: program.overviewUrl,
      admissionsUrl: program.admissionsUrl,
      tuitionUrl: "",
      keywords: program.keywords,
      tags: program.tags,
      sourceIds: ["curated-manual"],
      checkedAt: program.checkedAt,
      priority: program.priority,
    })
  ).sort(comparePrograms);
}

const DEFAULT_UNIVERSITIES = buildFallbackUniversities();
const DEFAULT_PROGRAMS = buildFallbackPrograms();

export async function readStudyAbroadCatalogSources() {
  const version = String(await getJsonArrayFileVersion(SOURCE_FILE));
  return readDerivedCatalogCache("catalog:sources", version, () =>
    readJsonArrayFile({
      fileName: SOURCE_FILE,
      fallback: [],
      normalize: normalizeSource,
      isValid: isValidSource,
      compare: compareByPriority,
    })
  );
}

export async function readStudyAbroadCatalogUniversities() {
  const version = String(await getJsonArrayFileVersion(UNIVERSITY_FILE));
  return readDerivedCatalogCache("catalog:universities", version, () =>
    readJsonArrayFile({
      fileName: UNIVERSITY_FILE,
      fallback: DEFAULT_UNIVERSITIES,
      normalize: normalizeUniversity,
      isValid: isValidUniversity,
      compare: compareUniversities,
    })
  );
}

export async function readStudyAbroadCatalogPrograms() {
  const version = String(await getJsonArrayFileVersion(PROGRAM_FILE));
  return readDerivedCatalogCache("catalog:programs", version, () =>
    readJsonArrayFile({
      fileName: PROGRAM_FILE,
      fallback: DEFAULT_PROGRAMS,
      normalize: normalizeProgram,
      isValid: isValidProgram,
      compare: comparePrograms,
    })
  );
}

export async function writeStudyAbroadCatalogUniversities(
  universities: StudyAbroadCatalogUniversity[]
) {
  invalidateJsonArrayFileCache(UNIVERSITY_FILE);
  invalidateStudyAbroadCatalogDerivedCache();
  return writeJsonArrayFile(universities, {
    fileName: UNIVERSITY_FILE,
    normalize: normalizeUniversity,
    isValid: isValidUniversity,
    compare: compareUniversities,
  });
}

export async function writeStudyAbroadCatalogPrograms(programs: StudyAbroadCatalogProgram[]) {
  invalidateJsonArrayFileCache(PROGRAM_FILE);
  invalidateStudyAbroadCatalogDerivedCache();
  return writeJsonArrayFile(programs, {
    fileName: PROGRAM_FILE,
    normalize: normalizeProgram,
    isValid: isValidProgram,
    compare: comparePrograms,
  });
}

export async function readStudyAbroadCatalogSummary() {
  const [sourceVersion, universityVersion, programVersion] = await Promise.all([
    getJsonArrayFileVersion(SOURCE_FILE),
    getJsonArrayFileVersion(UNIVERSITY_FILE),
    getJsonArrayFileVersion(PROGRAM_FILE),
  ]);
  const version = `${sourceVersion}:${universityVersion}:${programVersion}`;

  return readDerivedCatalogCache("catalog:summary", version, async () => {
    const [sources, universities, programs] = await Promise.all([
      readStudyAbroadCatalogSources(),
      readStudyAbroadCatalogUniversities(),
      readStudyAbroadCatalogPrograms(),
    ]);

  const countries = new Set(universities.map((item) => item.country));
  const qsCoverage = universities.filter((item) => item.qsRank !== null).length;
  const tuitionCoverage = programs.filter((item) => item.tuitionAmount).length;
  const admissionsCoverage = programs.filter((item) => item.admissionsSnapshot?.extractedAt).length;
  const structuredAdmissionsCoverage = programs.filter((item) => {
    const snapshot = item.admissionsSnapshot;
    if (!snapshot) return false;

    return Boolean(
      snapshot.gpaMin ||
        snapshot.ieltsMin ||
        snapshot.toeflMin ||
        snapshot.duolingoMin ||
        snapshot.pteMin ||
        snapshot.greStatus !== "unknown" ||
        snapshot.gmatStatus !== "unknown" ||
        snapshot.workExperienceYears
    );
  }).length;
  const completeAdmissionsCoverage = programs.filter(
    (item) => item.admissionsSnapshot?.extractionStatus === "ok"
  ).length;
  const sourceStatusCounts = sources.reduce<Record<string, number>>((acc, source) => {
    acc[source.status] = (acc[source.status] ?? 0) + 1;
    return acc;
  }, {});
  const buildCoverageGroups = (getLabel: (program: StudyAbroadCatalogProgram) => string) => {
    const map = new Map<string, StudyAbroadAdmissionsCoverageGroup>();

    programs.forEach((program) => {
      const label = getLabel(program);
      if (!label) return;

      const snapshot = program.admissionsSnapshot;
      const hasSynced = Boolean(snapshot?.extractedAt);
      const hasStructured = Boolean(
        snapshot &&
          (
            snapshot.gpaMin ||
            snapshot.ieltsMin ||
            snapshot.toeflMin ||
            snapshot.duolingoMin ||
            snapshot.pteMin ||
            snapshot.greStatus !== "unknown" ||
            snapshot.gmatStatus !== "unknown" ||
            snapshot.workExperienceYears
          )
      );
      const isComplete = snapshot?.extractionStatus === "ok";
      const current = map.get(label) ?? {
        label,
        totalPrograms: 0,
        syncedPrograms: 0,
        structuredPrograms: 0,
        completePrograms: 0,
        missingPrograms: 0,
      };

      current.totalPrograms += 1;
      if (hasSynced) current.syncedPrograms += 1;
      if (hasStructured) current.structuredPrograms += 1;
      if (isComplete) current.completePrograms += 1;
      if (!hasSynced) current.missingPrograms += 1;

      map.set(label, current);
    });

    return Array.from(map.values()).sort((left, right) => {
      if (left.missingPrograms !== right.missingPrograms) {
        return right.missingPrograms - left.missingPrograms;
      }

      if (left.totalPrograms !== right.totalPrograms) {
        return right.totalPrograms - left.totalPrograms;
      }

      return left.label.localeCompare(right.label, "zh-CN");
    });
  };
  const countryAdmissionsCoverage = buildCoverageGroups((program) => program.country);
  const disciplineAdmissionsCoverage = buildCoverageGroups((program) => program.discipline);

    return {
      sources,
      universities,
      programs,
      stats: {
        sourceCount: sources.length,
        universityCount: universities.length,
        programCount: programs.length,
        countryCount: countries.size,
        qsCoverage,
        tuitionCoverage,
        admissionsCoverage,
        structuredAdmissionsCoverage,
        completeAdmissionsCoverage,
        sourceStatusCounts,
        countryAdmissionsCoverage,
        disciplineAdmissionsCoverage,
      },
    };
  });
}

export async function readStudyAbroadFinderPrograms() {
  const [universityVersion, programVersion] = await Promise.all([
    getJsonArrayFileVersion(UNIVERSITY_FILE),
    getJsonArrayFileVersion(PROGRAM_FILE),
  ]);
  const version = `${universityVersion}:${programVersion}`;

  return readDerivedCatalogCache("finder:programs", version, async () => {
    const [universities, programs] = await Promise.all([
      readStudyAbroadCatalogUniversities(),
      readStudyAbroadCatalogPrograms(),
    ]);

    const universityMap = new Map(universities.map((item) => [item.id, item]));

    return programs
      .map((program) => {
        const university = universityMap.get(program.universityId);

        return {
          ...program,
          schoolNameZh: university?.nameZh || program.schoolNameZh || "",
          officialWebsite: university?.officialWebsite ?? safeOrigin(program.overviewUrl),
          websiteDomain: university?.websiteDomain ?? safeHost(program.overviewUrl),
          qsRank: university?.qsRank ?? null,
          qsRankingYear: university?.qsRankingYear ?? null,
          rankingSource: university?.rankingSource ?? "",
        } satisfies StudyAbroadFinderProgram;
      })
      .sort(compareFinderPrograms);
  });
}

export async function readStudyAbroadFinderCountries() {
  const version = String(await getJsonArrayFileVersion(UNIVERSITY_FILE));

  return readDerivedCatalogCache("finder:countries", version, async () => {
    const universities = await readStudyAbroadCatalogUniversities();
    return Array.from(
      new Set(universities.map((item) => item.country).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  });
}

export async function readStudyAbroadFinderProgramById(programId: string) {
  const programs = await readStudyAbroadFinderPrograms();
  return programs.find((program) => program.id === programId) ?? null;
}
