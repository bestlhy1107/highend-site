import {
  compareByOrder,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import { normalizeStringArray, splitCsv } from "./text-fields";

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

function normalizeTeacher(input: Partial<RuntimeTeacher>): RuntimeTeacher {
  return {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "").trim(),
    title: String(input.title ?? "").trim(),
    order: Number(input.order ?? 999),
    avatar: String(input.avatar ?? "").trim(),
    intro: String(input.intro ?? "").trim(),
    specialties: normalizeStringArray(input.specialties),
    badges: normalizeStringArray(input.badges),
  };
}

function isValidTeacher(teacher: RuntimeTeacher) {
  return Boolean(teacher.id && teacher.name);
}

export async function readTeachers(): Promise<RuntimeTeacher[]> {
  return readJsonArrayFile({
    fileName: "teachers.json",
    fallback: DEFAULT_TEACHERS,
    normalize: normalizeTeacher,
    isValid: isValidTeacher,
    compare: compareByOrder,
  });
}

export async function readTeacherById(id: string) {
  const teachers = await readTeachers();
  return teachers.find((teacher) => teacher.id === id) ?? null;
}

export async function writeTeachers(teachers: RuntimeTeacher[]) {
  return writeJsonArrayFile(teachers, {
    fileName: "teachers.json",
    normalize: normalizeTeacher,
    isValid: isValidTeacher,
    compare: compareByOrder,
  });
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
    specialties: splitCsv(input.specialties),
    badges: splitCsv(input.badges),
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
