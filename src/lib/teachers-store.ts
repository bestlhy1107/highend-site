import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeTeacher = {
  id: string;
  name: string;
  title: string;
  order: number;
  avatar?: string;
  intro?: string;
  specialties: string[];
  badges: string[];
};

const DEFAULT_TEACHERS: RuntimeTeacher[] = [
  {
    id: "amy",
    name: "Amy",
    title: "TOEFL / IELTS 导师",
    order: 1,
    avatar: "/images/teachers/amy.jpg",
    intro: "擅长托福口语、雅思写作与学习规划。",
    specialties: ["TOEFL", "IELTS", "口语", "写作"],
    badges: ["高分规划", "一对一指导"],
  },
];

function getTeachersFilePath() {
  return join(process.cwd(), "data", "teachers.json");
}

function normalizeTeacher(input: Partial<RuntimeTeacher>): RuntimeTeacher {
  return {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "").trim(),
    title: String(input.title ?? "").trim(),
    order: Number(input.order ?? 999),
    avatar: String(input.avatar ?? "").trim(),
    intro: String(input.intro ?? "").trim(),
    specialties: Array.isArray(input.specialties) ? input.specialties : [],
    badges: Array.isArray(input.badges) ? input.badges : [],
  };
}

export async function readTeachers(): Promise<RuntimeTeacher[]> {
  try {
    const raw = await readFile(getTeachersFilePath(), "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return DEFAULT_TEACHERS;

    return parsed
      .map(normalizeTeacher)
      .filter((t) => t.id && t.name)
      .sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_TEACHERS;
  }
}

export async function writeTeachers(teachers: RuntimeTeacher[]) {
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });

  const normalized = teachers
    .map(normalizeTeacher)
    .filter((t) => t.id && t.name)
    .sort((a, b) => a.order - b.order);

  await writeFile(
    getTeachersFilePath(),
    JSON.stringify(normalized, null, 2),
    "utf8"
  );

  return normalized;
}

export async function upsertTeacher(input: {
  id?: string;
  name: string;
  title: string;
  order: number;
  avatar?: string;
  intro?: string;
  specialties?: string;
  badges?: string;
}) {
  const teachers = await readTeachers();

  const id =
    input.id && input.id.trim()
      ? input.id.trim()
      : crypto.randomUUID().slice(0, 8);

  const nextTeacher: RuntimeTeacher = {
    id,
    name: input.name.trim(),
    title: input.title.trim(),
    order: Number(input.order),
    avatar: String(input.avatar ?? "").trim(),
    intro: String(input.intro ?? "").trim(),
    specialties: String(input.specialties ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    badges: String(input.badges ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const index = teachers.findIndex((t) => t.id === id);
  if (index >= 0) {
    teachers[index] = nextTeacher;
  } else {
    teachers.push(nextTeacher);
  }

  return writeTeachers(teachers);
}

export async function deleteTeacher(id: string) {
  const teachers = await readTeachers();
  const next = teachers.filter((t) => t.id !== id);
  return writeTeachers(next);
}