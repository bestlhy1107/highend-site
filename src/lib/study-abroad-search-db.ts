import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { dataFilePath, getJsonArrayFileVersion } from "./json-file-store";
import {
  MAJOR_FAMILIES,
  MAJOR_QUERY_ALIASES,
  SPECIALIZATION_QUERY_ALIASES,
  SPECIALIZATION_TO_MAJOR,
} from "./study-abroad-programs";
import {
  buildStudyAbroadFinderProgramsFromCatalog,
  readStudyAbroadCatalogPrograms,
  readStudyAbroadCatalogUniversities,
  type StudyAbroadCatalogUniversity,
  type StudyAbroadFinderProgram,
} from "./study-abroad-catalog-store";
import type {
  StudyAbroadResolvedQuery,
  StudyAbroadUniversityMatch,
} from "./study-abroad-search";

type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): unknown;
  };
  close(): void;
};

type DatabaseSyncConstructor = new (
  location: string,
  options?: Record<string, unknown>
) => SqliteDatabase;

export type StudyAbroadSearchDbPagination = {
  page?: number;
  pageSize?: number;
  universityPage?: number;
  universityPageSize?: number;
};

export type StudyAbroadSearchDbResult = {
  programs: StudyAbroadFinderProgram[];
  totalCount: number;
  displayedCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  universityMatches: StudyAbroadUniversityMatch[];
  totalUniversityCount: number;
  dbFile: string;
};

type SqlWhere = {
  sql: string;
  params: unknown[];
};

const SEARCH_DB_FILE = "study-abroad-search.sqlite";
const DEFAULT_PAGE_SIZE = 160;
const MAX_PAGE_SIZE = 200;
const DEFAULT_UNIVERSITY_PAGE_SIZE = 240;
const MAX_UNIVERSITY_PAGE_SIZE = 300;
const FREE_TEXT_STOPWORDS = new Set([
  "申请",
  "留学",
  "大学",
  "学校",
  "项目",
  "专业",
  "方向",
  "官网",
  "官方",
  "高中",
  "中学",
  "本科",
  "硕士",
  "博士",
  "美国",
  "英国",
  "加拿大",
  "澳大利亚",
  "新加坡",
  "中国香港",
  "master",
  "masters",
  "program",
  "programme",
  "official",
  "admission",
  "admissions",
  "graduate",
  "university",
]);

let sqliteConstructorPromise: Promise<DatabaseSyncConstructor | null> | null = null;

function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[()]/g, " ")
    .replace(/[.,/\\\-:：;；|]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeToken(value: string) {
  return normalizeSearchText(value).trim();
}

function uniqueItems(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function numericValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function likeParam(value: string) {
  return `%${escapeLike(normalizeToken(value))}%`;
}

function isShortAsciiToken(value: string) {
  return /^[a-z0-9]{1,2}$/i.test(value);
}

function likeCondition(column: string, term: string) {
  const normalized = normalizeToken(term);
  if (isShortAsciiToken(normalized)) {
    return {
      sql: `(' ' || ${column} || ' ') LIKE ? ESCAPE '\\'`,
      param: `% ${escapeLike(normalized)} %`,
    };
  }

  return {
    sql: `${column} LIKE ? ESCAPE '\\'`,
    param: likeParam(normalized),
  };
}

function clampPositiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(max, parsed);
}

function searchDbPath() {
  return dataFilePath(SEARCH_DB_FILE);
}

async function getDatabaseSyncConstructor() {
  if (!sqliteConstructorPromise) {
    sqliteConstructorPromise = (async () => {
      try {
        const loader = Function("return import('node:sqlite')");
        const sqlite = (await loader()) as { DatabaseSync?: DatabaseSyncConstructor };
        return sqlite.DatabaseSync ?? null;
      } catch {
        return null;
      }
    })();
  }

  return sqliteConstructorPromise;
}

async function openSearchDb(readOnly: boolean) {
  const DatabaseSync = await getDatabaseSyncConstructor();
  if (!DatabaseSync) return null;

  try {
    return new DatabaseSync(searchDbPath(), readOnly ? { readOnly: true } : undefined);
  } catch {
    return null;
  }
}

async function searchDbMtime() {
  try {
    return (await stat(searchDbPath())).mtimeMs;
  } catch {
    return 0;
  }
}

async function isFreshSearchDb() {
  const [dbVersion, universityVersion, programVersion] = await Promise.all([
    searchDbMtime(),
    getJsonArrayFileVersion("study-abroad-universities.json"),
    getJsonArrayFileVersion("study-abroad-programs.json"),
  ]);

  return Boolean(dbVersion && dbVersion >= Math.max(Number(universityVersion), Number(programVersion)));
}

function programSearchText(program: StudyAbroadFinderProgram) {
  return normalizeSearchText(
    [
      program.id,
      program.universityId,
      program.schoolName,
      program.schoolNameZh,
      program.country,
      program.city,
      program.stateOrProvince,
      program.programName,
      program.degree,
      program.discipline,
      program.summary,
      program.duration,
      program.intake,
      program.tuitionNotes,
      program.websiteDomain,
      ...(program.keywords ?? []),
      ...(program.tags ?? []),
      ...(program.sourceIds ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function universitySearchText(
  university: StudyAbroadCatalogUniversity,
  match: StudyAbroadUniversityMatch
) {
  return normalizeSearchText(
    [
      university.id,
      university.name,
      university.nameZh,
      university.country,
      university.city,
      university.stateOrProvince,
      university.websiteDomain,
      ...(match.topDisciplines ?? []),
      ...(match.featuredPrograms ?? []),
      ...(university.sourceIds ?? []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function buildUniversityMatchesForDb(
  universities: StudyAbroadCatalogUniversity[],
  programs: StudyAbroadFinderProgram[]
) {
  const universityById = new Map(universities.map((item) => [item.id, item]));
  const matches = new Map<string, StudyAbroadUniversityMatch>();

  universities.forEach((university) => {
    matches.set(university.id, {
      universityId: university.id,
      schoolName: university.name,
      schoolNameZh: university.nameZh || "",
      country: university.country,
      city: university.city,
      stateOrProvince: university.stateOrProvince,
      officialWebsite: university.officialWebsite,
      qsRank: university.qsRank ?? null,
      qsRankingYear: university.qsRankingYear ?? null,
      rankingSource: university.rankingSource ?? "",
      programCount: 0,
      featuredScore: 0,
      topDisciplines: [],
      featuredPrograms: [],
      tuitionProjectCount: 0,
      tuitionMin: null,
      tuitionMax: null,
      tuitionCurrency: "",
    });
  });

  programs.forEach((program) => {
    const university = universityById.get(program.universityId);
    const key = program.universityId || program.schoolName;
    const current =
      matches.get(key) ??
      ({
        universityId: key,
        schoolName: program.schoolName,
        schoolNameZh: program.schoolNameZh || "",
        country: program.country,
        city: program.city,
        stateOrProvince: program.stateOrProvince,
        officialWebsite: program.officialWebsite || program.overviewUrl,
        qsRank: program.qsRank ?? null,
        qsRankingYear: program.qsRankingYear ?? null,
        rankingSource: program.rankingSource ?? "",
        programCount: 0,
        featuredScore: 0,
        topDisciplines: [],
        featuredPrograms: [],
        tuitionProjectCount: 0,
        tuitionMin: null,
        tuitionMax: null,
        tuitionCurrency: "",
      } satisfies StudyAbroadUniversityMatch);

    current.programCount += 1;
    current.featuredScore = Math.max(current.featuredScore, Number(program.priority ?? 0));

    if ((!current.schoolNameZh || current.schoolNameZh === current.schoolName) && university?.nameZh) {
      current.schoolNameZh = university.nameZh;
    }

    if (program.discipline && !current.topDisciplines.includes(program.discipline)) {
      current.topDisciplines = [...current.topDisciplines, program.discipline].slice(0, 3);
    }

    if (program.programName && !current.featuredPrograms.includes(program.programName)) {
      current.featuredPrograms = [...current.featuredPrograms, program.programName].slice(0, 2);
    }

    const tuitionAmount = Number(program.tuitionAmount);
    if (Number.isFinite(tuitionAmount) && tuitionAmount > 0) {
      current.tuitionProjectCount += 1;
      current.tuitionMin =
        current.tuitionMin === null ? tuitionAmount : Math.min(current.tuitionMin, tuitionAmount);
      current.tuitionMax =
        current.tuitionMax === null ? tuitionAmount : Math.max(current.tuitionMax, tuitionAmount);
      if (!current.tuitionCurrency && program.tuitionCurrency) {
        current.tuitionCurrency = program.tuitionCurrency;
      }
    }

    matches.set(key, current);
  });

  return Array.from(matches.values());
}

function hasStructuredSnapshot(program: StudyAbroadFinderProgram) {
  const snapshot = program.admissionsSnapshot;
  if (!snapshot?.extractedAt) return false;

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
}

function sqliteJson(value: unknown) {
  return JSON.stringify(value);
}

export async function rebuildStudyAbroadSearchDatabase() {
  const DatabaseSync = await getDatabaseSyncConstructor();
  const dbPath = searchDbPath();

  if (!DatabaseSync) {
    return {
      searchDbAvailable: false,
      searchDbFile: SEARCH_DB_FILE,
      programCount: 0,
      universityCount: 0,
      message: "当前 Node 运行时不支持 node:sqlite，已跳过 SQLite 搜索库生成。",
    };
  }

  const tmpPath = `${dbPath}.tmp`;
  await mkdir(dirname(dbPath), { recursive: true });
  await rm(tmpPath, { force: true });

  const [universities, catalogPrograms] = await Promise.all([
    readStudyAbroadCatalogUniversities(),
    readStudyAbroadCatalogPrograms(),
  ]);
  const finderPrograms = buildStudyAbroadFinderProgramsFromCatalog(universities, catalogPrograms);
  const universityMatches = buildUniversityMatchesForDb(universities, finderPrograms);
  const universityById = new Map(universities.map((item) => [item.id, item]));
  const db = new DatabaseSync(tmpPath);

  try {
    db.exec(`
      PRAGMA journal_mode = OFF;
      PRAGMA synchronous = OFF;
      PRAGMA temp_store = MEMORY;
      CREATE TABLE meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE programs (
        id TEXT PRIMARY KEY,
        university_id TEXT NOT NULL,
        school_name TEXT NOT NULL,
        country TEXT NOT NULL,
        degree TEXT NOT NULL,
        discipline TEXT NOT NULL,
        city TEXT NOT NULL,
        state_or_province TEXT NOT NULL,
        priority REAL NOT NULL,
        tuition_amount REAL,
        qs_rank REAL,
        snapshot_status TEXT NOT NULL,
        has_snapshot INTEGER NOT NULL,
        has_structured_snapshot INTEGER NOT NULL,
        has_admissions_url INTEGER NOT NULL,
        intake TEXT NOT NULL,
        search_text TEXT NOT NULL,
        detail_json TEXT NOT NULL
      );
      CREATE TABLE universities (
        university_id TEXT PRIMARY KEY,
        school_name TEXT NOT NULL,
        country TEXT NOT NULL,
        city TEXT NOT NULL,
        state_or_province TEXT NOT NULL,
        qs_rank REAL,
        featured_score REAL NOT NULL,
        program_count INTEGER NOT NULL,
        tuition_project_count INTEGER NOT NULL,
        tuition_min REAL,
        tuition_max REAL,
        search_text TEXT NOT NULL,
        detail_json TEXT NOT NULL
      );
      CREATE INDEX idx_programs_country_degree ON programs(country, degree);
      CREATE INDEX idx_programs_university ON programs(university_id);
      CREATE INDEX idx_programs_discipline ON programs(discipline);
      CREATE INDEX idx_programs_tuition ON programs(tuition_amount);
      CREATE INDEX idx_programs_priority ON programs(priority);
      CREATE INDEX idx_universities_country ON universities(country);
      CREATE INDEX idx_universities_program_count ON universities(program_count);
    `);

    const insertMeta = db.prepare("INSERT INTO meta(key, value) VALUES (?, ?)");
    const insertProgram = db.prepare(`
      INSERT INTO programs (
        id,
        university_id,
        school_name,
        country,
        degree,
        discipline,
        city,
        state_or_province,
        priority,
        tuition_amount,
        qs_rank,
        snapshot_status,
        has_snapshot,
        has_structured_snapshot,
        has_admissions_url,
        intake,
        search_text,
        detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertUniversity = db.prepare(`
      INSERT INTO universities (
        university_id,
        school_name,
        country,
        city,
        state_or_province,
        qs_rank,
        featured_score,
        program_count,
        tuition_project_count,
        tuition_min,
        tuition_max,
        search_text,
        detail_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.exec("BEGIN");
    insertMeta.run("createdAt", new Date().toISOString());
    insertMeta.run("programCount", String(finderPrograms.length));
    insertMeta.run("universityCount", String(universityMatches.length));

    finderPrograms.forEach((program) => {
      insertProgram.run(
        program.id,
        program.universityId,
        program.schoolName,
        program.country,
        program.degree,
        program.discipline,
        program.city,
        program.stateOrProvince,
        Number(program.priority ?? 0),
        numericValue(program.tuitionAmount),
        numericValue(program.qsRank),
        program.admissionsSnapshot?.extractionStatus ?? "",
        program.admissionsSnapshot?.extractedAt ? 1 : 0,
        hasStructuredSnapshot(program) ? 1 : 0,
        program.admissionsUrl ? 1 : 0,
        program.intake || "",
        programSearchText(program),
        sqliteJson(program)
      );
    });

    universityMatches.forEach((match) => {
      const university = universityById.get(match.universityId);
      insertUniversity.run(
        match.universityId,
        match.schoolName,
        match.country,
        match.city,
        match.stateOrProvince,
        numericValue(match.qsRank),
        Number(match.featuredScore ?? 0),
        Number(match.programCount ?? 0),
        Number(match.tuitionProjectCount ?? 0),
        numericValue(match.tuitionMin),
        numericValue(match.tuitionMax),
        university ? universitySearchText(university, match) : normalizeSearchText(sqliteJson(match)),
        sqliteJson(match)
      );
    });

    db.exec("COMMIT");
    db.exec("ANALYZE");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback errors after failed setup.
    }
    throw error;
  } finally {
    db.close();
  }

  await rename(tmpPath, dbPath);

  return {
    searchDbAvailable: true,
    searchDbFile: SEARCH_DB_FILE,
    programCount: finderPrograms.length,
    universityCount: universityMatches.length,
    message: `已生成 SQLite 搜索库：${finderPrograms.length} 个项目，${universityMatches.length} 所学校。`,
  };
}

function getMeaningfulTokens(...values: string[]) {
  return uniqueItems(
    values
      .flatMap((value) => normalizeSearchText(value).split(" "))
      .map((token) => token.trim())
      .filter((token) => token && token.length > 1 && !FREE_TEXT_STOPWORDS.has(token))
  ).slice(0, 8);
}

function expandAliases(
  rawValue: string,
  aliasGroups: Record<string, string[]>,
  fallback: string[]
) {
  const value = normalizeSearchText(rawValue);
  if (!value) return fallback.filter(Boolean);

  const expanded = new Set(fallback.filter(Boolean));
  Object.entries(aliasGroups).forEach(([label, aliases]) => {
    const labelText = normalizeSearchText(label);
    const matched =
      value.includes(labelText) ||
      aliases.some((alias) => value.includes(normalizeSearchText(alias))) ||
      label === rawValue;

    if (!matched) return;
    expanded.add(label);
    aliases.forEach((alias) => expanded.add(alias));
  });

  expanded.add(rawValue);
  return Array.from(expanded).filter(Boolean);
}

function majorTerms(query: StudyAbroadResolvedQuery) {
  const major = expectedDisciplineForQuery(query);
  const terms = [
    ...expandAliases(major, MAJOR_QUERY_ALIASES, [major]),
    ...expandAliases(major, MAJOR_FAMILIES, []),
    ...expandAliases(query.specialization, SPECIALIZATION_QUERY_ALIASES, [
      query.specialization,
    ]),
  ];

  return uniqueItems(terms).slice(0, 18);
}

function expectedDisciplineForQuery(query: StudyAbroadResolvedQuery) {
  return query.major || (query.specialization ? SPECIALIZATION_TO_MAJOR[query.specialization] || "" : "");
}

function addLikeAnyFilter(where: string[], params: unknown[], column: string, terms: string[]) {
  const normalized = uniqueItems(terms.map(normalizeToken).filter(Boolean));
  if (!normalized.length) return;

  const conditions = normalized.map((term) => likeCondition(column, term));
  where.push(`(${conditions.map((condition) => condition.sql).join(" OR ")})`);
  conditions.forEach((condition) => params.push(condition.param));
}

function addLikeAllFilter(where: string[], params: unknown[], column: string, terms: string[]) {
  const normalized = uniqueItems(terms.map(normalizeToken).filter(Boolean));
  normalized.forEach((term) => {
    const condition = likeCondition(column, term);
    where.push(condition.sql);
    params.push(condition.param);
  });
}

function buildProgramWhere(query: StudyAbroadResolvedQuery, columnPrefix = ""): SqlWhere {
  const where = ["1 = 1"];
  const params: unknown[] = [];
  const column = (name: string) => `${columnPrefix}${name}`;

  if (query.universityId) {
    where.push(`${column("university_id")} = ?`);
    params.push(query.universityId);
  }

  if (query.country) {
    where.push(`${column("country")} = ?`);
    params.push(query.country);
  }

  if (query.degree) {
    where.push(`${column("degree")} = ?`);
    params.push(query.degree);
  }

  if (query.snapshotQuality === "ready-only") {
    where.push(`${column("snapshot_status")} = 'ok'`);
  } else if (query.snapshotQuality === "synced-only") {
    where.push(`${column("has_snapshot")} = 1`);
  } else if (query.snapshotQuality === "structured-only") {
    where.push(`${column("has_structured_snapshot")} = 1`);
  }

  if (query.budgetTier) {
    where.push(`${column("tuition_amount")} IS NOT NULL`);
    if (query.budgetTier === "under-30000") where.push(`${column("tuition_amount")} <= 30000`);
    if (query.budgetTier === "under-50000") where.push(`${column("tuition_amount")} <= 50000`);
    if (query.budgetTier === "under-70000") where.push(`${column("tuition_amount")} <= 70000`);
    if (query.budgetTier === "under-90000") where.push(`${column("tuition_amount")} <= 90000`);
  }

  if (query.intake) {
    addLikeAnyFilter(where, params, column("search_text"), [query.intake]);
  }

  const expectedDiscipline = expectedDisciplineForQuery(query);
  if (expectedDiscipline) {
    where.push(`${column("discipline")} = ?`);
    params.push(expectedDiscipline);

    if (query.specialization) {
      addLikeAnyFilter(
        where,
        params,
        column("search_text"),
        expandAliases(query.specialization, SPECIALIZATION_QUERY_ALIASES, [query.specialization])
      );
    }
  } else {
    addLikeAnyFilter(where, params, column("search_text"), majorTerms(query));
  }

  const freeTextTokens = getMeaningfulTokens(query.freeText).filter(
    (token) => token !== normalizeSearchText(query.country) && token !== normalizeSearchText(query.degree)
  );
  addLikeAllFilter(where, params, column("search_text"), freeTextTokens);

  return {
    sql: where.join(" AND "),
    params,
  };
}

function buildScoreExpression(query: StudyAbroadResolvedQuery) {
  const parts = ["priority"];
  const params: unknown[] = [];

  if (query.country) parts.push("12");
  if (query.degree) parts.push("6");

  const expectedDiscipline = expectedDisciplineForQuery(query);
  if (expectedDiscipline) {
    parts.push("CASE WHEN discipline = ? THEN 18 ELSE 0 END");
    params.push(expectedDiscipline);
  }

  majorTerms(query).slice(0, 10).forEach((term) => {
    const condition = likeCondition("search_text", term);
    parts.push(`CASE WHEN ${condition.sql} THEN 6 ELSE 0 END`);
    params.push(condition.param);
  });

  getMeaningfulTokens(query.freeText).slice(0, 6).forEach((term) => {
    const condition = likeCondition("search_text", term);
    parts.push(`CASE WHEN ${condition.sql} THEN 3 ELSE 0 END`);
    params.push(condition.param);
  });

  parts.push("CASE WHEN has_structured_snapshot = 1 THEN 6 WHEN has_snapshot = 1 THEN 3 ELSE 0 END");
  parts.push("CASE WHEN has_admissions_url = 1 THEN 2 ELSE 0 END");
  parts.push("CASE WHEN tuition_amount IS NOT NULL AND tuition_amount > 0 THEN 2 ELSE 0 END");
  parts.push("CASE WHEN qs_rank IS NOT NULL AND qs_rank > 0 THEN 2 ELSE 0 END");

  return {
    sql: parts.join(" + "),
    params,
  };
}

function parseProgramRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      try {
        return JSON.parse(String(row.detail_json ?? "")) as StudyAbroadFinderProgram;
      } catch {
        return null;
      }
    })
    .filter((item): item is StudyAbroadFinderProgram => Boolean(item?.id));
}

function parseUniversityRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row) => {
      try {
        const item = JSON.parse(String(row.detail_json ?? "")) as StudyAbroadUniversityMatch;
        const programCount = Number(row.program_count ?? item.programCount ?? 0);
        const featuredScore = Number(row.featured_score ?? item.featuredScore ?? 0);
        const tuitionProjectCount = Number(row.tuition_project_count ?? item.tuitionProjectCount ?? 0);
        const tuitionMin = numericValue(row.tuition_min ?? item.tuitionMin);
        const tuitionMax = numericValue(row.tuition_max ?? item.tuitionMax);
        return {
          ...item,
          programCount,
          featuredScore,
          tuitionProjectCount,
          tuitionMin,
          tuitionMax,
        } satisfies StudyAbroadUniversityMatch;
      } catch {
        return null;
      }
    })
    .filter((item): item is StudyAbroadUniversityMatch => Boolean(item?.universityId));
}

function readTotal(row: Record<string, unknown> | undefined) {
  return Number(row?.total ?? 0) || 0;
}

function readPagination(input: StudyAbroadSearchDbPagination) {
  const page = clampPositiveInt(input.page, 1, 10000);
  const pageSize = clampPositiveInt(input.pageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const universityPage = clampPositiveInt(input.universityPage, 1, 10000);
  const universityPageSize = clampPositiveInt(
    input.universityPageSize,
    DEFAULT_UNIVERSITY_PAGE_SIZE,
    MAX_UNIVERSITY_PAGE_SIZE
  );

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
    universityPage,
    universityPageSize,
    universityOffset: (universityPage - 1) * universityPageSize,
  };
}

function hasOnlyCountrySchoolPoolFilter(query: StudyAbroadResolvedQuery) {
  return Boolean(
    query.country &&
      !query.universityId &&
      !query.degree &&
      !query.major &&
      !query.specialization &&
      !query.budgetTier &&
      !query.intake &&
      !query.snapshotQuality &&
      !getMeaningfulTokens(query.freeText).length
  );
}

function readProgramRows(
  db: SqliteDatabase,
  query: StudyAbroadResolvedQuery,
  pagination: ReturnType<typeof readPagination>
) {
  const where = buildProgramWhere(query);
  const score = buildScoreExpression(query);
  const total = readTotal(
    db.prepare(`SELECT COUNT(*) AS total FROM programs WHERE ${where.sql}`).get(...where.params)
  );
  const rows = db
    .prepare(`
      SELECT detail_json, (${score.sql}) AS score
      FROM programs
      WHERE ${where.sql}
      ORDER BY
        CASE WHEN qs_rank IS NULL OR qs_rank <= 0 THEN 999999 ELSE qs_rank END ASC,
        score DESC,
        priority DESC,
        school_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `)
    .all(...score.params, ...where.params, pagination.pageSize, pagination.offset);

  return {
    rows,
    total,
  };
}

function readUniversityRows(
  db: SqliteDatabase,
  query: StudyAbroadResolvedQuery,
  pagination: ReturnType<typeof readPagination>
) {
  if (hasOnlyCountrySchoolPoolFilter(query)) {
    const params = [query.country];
    const total = readTotal(
      db.prepare("SELECT COUNT(*) AS total FROM universities WHERE country = ?").get(...params)
    );
    const rows = db
      .prepare(`
        SELECT detail_json, program_count, featured_score, tuition_project_count, tuition_min, tuition_max
        FROM universities
        WHERE country = ?
        ORDER BY
          CASE WHEN qs_rank IS NULL OR qs_rank <= 0 THEN 999999 ELSE qs_rank END ASC,
          featured_score DESC,
          program_count DESC,
          school_name COLLATE NOCASE ASC
        LIMIT ? OFFSET ?
      `)
      .all(...params, pagination.universityPageSize, pagination.universityOffset);

    return { rows, total };
  }

  const where = buildProgramWhere(query, "p.");
  const total = readTotal(
    db
      .prepare(
        `SELECT COUNT(*) AS total FROM (SELECT p.university_id FROM programs p WHERE ${where.sql} GROUP BY p.university_id)`
      )
      .get(...where.params)
  );
  const rows = db
    .prepare(`
      SELECT
        u.detail_json AS detail_json,
        COUNT(p.id) AS program_count,
        MAX(p.priority) AS featured_score,
        SUM(CASE WHEN p.tuition_amount IS NOT NULL AND p.tuition_amount > 0 THEN 1 ELSE 0 END) AS tuition_project_count,
        MIN(CASE WHEN p.tuition_amount IS NOT NULL AND p.tuition_amount > 0 THEN p.tuition_amount ELSE NULL END) AS tuition_min,
        MAX(CASE WHEN p.tuition_amount IS NOT NULL AND p.tuition_amount > 0 THEN p.tuition_amount ELSE NULL END) AS tuition_max
      FROM programs p
      JOIN universities u ON u.university_id = p.university_id
      WHERE ${where.sql}
      GROUP BY p.university_id
      ORDER BY
        CASE WHEN u.qs_rank IS NULL OR u.qs_rank <= 0 THEN 999999 ELSE u.qs_rank END ASC,
        featured_score DESC,
        program_count DESC,
        u.school_name COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `)
    .all(...where.params, pagination.universityPageSize, pagination.universityOffset);

  return { rows, total };
}

export async function searchStudyAbroadProgramsFromDb(
  query: StudyAbroadResolvedQuery,
  paginationInput: StudyAbroadSearchDbPagination = {}
): Promise<StudyAbroadSearchDbResult | null> {
  if (!(await isFreshSearchDb())) {
    return null;
  }

  const db = await openSearchDb(true);
  if (!db) return null;

  try {
    const pagination = readPagination(paginationInput);
    const programResult = readProgramRows(db, query, pagination);
    const universityResult = readUniversityRows(db, query, pagination);
    const totalPages = Math.max(1, Math.ceil(programResult.total / pagination.pageSize));
    const programs = parseProgramRows(programResult.rows);

    return {
      programs,
      totalCount: programResult.total,
      displayedCount: programs.length,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages,
      hasMore: pagination.page < totalPages,
      universityMatches: parseUniversityRows(universityResult.rows),
      totalUniversityCount: universityResult.total,
      dbFile: SEARCH_DB_FILE,
    };
  } finally {
    db.close();
  }
}

export async function readStudyAbroadFinderProgramsByIdsFromDb(programIds: string[]) {
  const ids = uniqueItems(programIds).slice(0, 200);
  if (!ids.length || !(await isFreshSearchDb())) {
    return null;
  }

  const db = await openSearchDb(true);
  if (!db) return null;

  try {
    const placeholders = ids.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT detail_json FROM programs WHERE id IN (${placeholders})`)
      .all(...ids);
    const byId = new Map(parseProgramRows(rows).map((program) => [program.id, program]));
    return ids.map((id) => byId.get(id)).filter((item): item is StudyAbroadFinderProgram => Boolean(item));
  } finally {
    db.close();
  }
}

export async function getStudyAbroadSearchDbStatus() {
  const [DatabaseSync, fresh, mtime] = await Promise.all([
    getDatabaseSyncConstructor(),
    isFreshSearchDb(),
    searchDbMtime(),
  ]);

  return {
    available: Boolean(DatabaseSync),
    fresh,
    file: SEARCH_DB_FILE,
    mtime,
  };
}
