type ProgramLike = {
  id: string;
  universityId?: string;
  schoolName: string;
  country: string;
  degree: string;
  discipline: string;
  programName: string;
  priority?: number;
  qsRank?: number | null;
  admissionsUrl?: string;
  admissionsSnapshot?: {
    extractedAt?: string;
    gpaMin?: number | null;
    ieltsMin?: number | null;
    toeflMin?: number | null;
    duolingoMin?: number | null;
    pteMin?: number | null;
    greStatus?: string;
    gmatStatus?: string;
    workExperienceYears?: number | null;
  } | null;
};

type UniversityLike = {
  universityId?: string;
  schoolName: string;
  country: string;
};

const PROGRAM_DEGREE_WORDS = new Set([
  "master",
  "masters",
  "msc",
  "ms",
  "ma",
  "mba",
  "meng",
  "mres",
  "mfin",
  "mcomp",
  "mphil",
  "phd",
  "bachelor",
  "ba",
  "bs",
  "bsc",
  "of",
  "in",
  "the",
  "degree",
  "program",
  "programme",
]);

function normalizeDedupeText(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[()［］【】\[\]{}]/g, " ")
    .replace(/[.,/\\\-:：;；|+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeProgramTitle(value: string) {
  const tokens = normalizeDedupeText(value)
    .split(" ")
    .filter((token) => token && !PROGRAM_DEGREE_WORDS.has(token));

  return tokens.join(" ") || normalizeDedupeText(value);
}

function normalizeSchoolName(value: string) {
  return normalizeDedupeText(value)
    .replace(/\buniversity of london\b/g, "")
    .replace(/\bthe\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQsRank(value: number | null | undefined) {
  const rank = Number(value);
  return Number.isFinite(rank) && rank > 0 ? rank : 999999;
}

function hasStructuredSnapshot(program: ProgramLike) {
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

export function getStudyAbroadUniversityDedupeKey(item: UniversityLike) {
  return [normalizeDedupeText(item.country), normalizeSchoolName(item.schoolName)]
    .filter(Boolean)
    .join("|");
}

export function getStudyAbroadProgramDedupeKey(program: ProgramLike) {
  return [
    getStudyAbroadUniversityDedupeKey(program),
    normalizeDedupeText(program.degree),
    normalizeDedupeText(program.discipline),
    normalizeProgramTitle(program.programName),
  ]
    .filter(Boolean)
    .join("|");
}

export function compareStudyAbroadProgramDedupeWinner(
  left: ProgramLike,
  right: ProgramLike
) {
  const leftRank = normalizeQsRank(left.qsRank);
  const rightRank = normalizeQsRank(right.qsRank);
  if (leftRank !== rightRank) return leftRank - rightRank;

  const leftPriority = Number(left.priority ?? 0);
  const rightPriority = Number(right.priority ?? 0);
  if (leftPriority !== rightPriority) return rightPriority - leftPriority;

  const leftStructured = hasStructuredSnapshot(left) ? 1 : 0;
  const rightStructured = hasStructuredSnapshot(right) ? 1 : 0;
  if (leftStructured !== rightStructured) return rightStructured - leftStructured;

  const leftSnapshot = left.admissionsSnapshot?.extractedAt ? 1 : 0;
  const rightSnapshot = right.admissionsSnapshot?.extractedAt ? 1 : 0;
  if (leftSnapshot !== rightSnapshot) return rightSnapshot - leftSnapshot;

  const leftAdmissions = left.admissionsUrl ? 1 : 0;
  const rightAdmissions = right.admissionsUrl ? 1 : 0;
  if (leftAdmissions !== rightAdmissions) return rightAdmissions - leftAdmissions;

  return String(left.id).localeCompare(String(right.id));
}

export function dedupeStudyAbroadPrograms<T extends ProgramLike>(programs: T[]) {
  const bestByKey = new Map<string, T>();

  programs.forEach((program) => {
    const key = getStudyAbroadProgramDedupeKey(program) || program.id;
    const current = bestByKey.get(key);
    if (!current || compareStudyAbroadProgramDedupeWinner(program, current) < 0) {
      bestByKey.set(key, program);
    }
  });

  return Array.from(bestByKey.values());
}
