import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeServiceFaq = {
  q: string;
  a: string;
};

export type RuntimeService = {
  id: string;
  title: string;
  subtitle: string;
  category: "language" | "abroad";
  order: number;
  icon?: string;
  heroImage?: string;
  officialRegisterUrl?: string;
  summary?: string;
  highlights: string[];
  faqs: RuntimeServiceFaq[];
  tags: string[];
};

const DEFAULT_SERVICES: RuntimeService[] = [
  {
    id: "toefl",
    title: "托福课程",
    subtitle: "托福口语 / 写作 / 模考系统提升",
    category: "language",
    order: 1,
    icon: "🎯",
    heroImage: "",
    officialRegisterUrl: "https://www.ets.org/toefl.html",
    summary: "托福课程覆盖词汇、阅读、听力、口语、写作与模考训练。",
    highlights: ["入学诊断", "阶段测评", "口语写作精修", "模考复盘"],
    faqs: [
      {
        q: "需要基础吗？",
        a: "可以先做诊断，再安排对应班型。",
      },
    ],
    tags: ["TOEFL", "口语", "写作", "模考"],
  },
];

function getServicesFilePath() {
  return join(process.cwd(), "data", "services.json");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeService(input: Partial<RuntimeService>): RuntimeService {
  return {
    id: String(input.id ?? "").trim(),
    title: String(input.title ?? "").trim(),
    subtitle: String(input.subtitle ?? "").trim(),
    category: input.category === "abroad" ? "abroad" : "language",
    order: Number(input.order ?? 999),
    icon: String(input.icon ?? "").trim(),
    heroImage: String(input.heroImage ?? "").trim(),
    officialRegisterUrl: String(input.officialRegisterUrl ?? "").trim(),
    summary: String(input.summary ?? "").trim(),
    highlights: Array.isArray(input.highlights)
      ? input.highlights.map((s) => String(s)).filter(Boolean)
      : [],
    faqs: Array.isArray(input.faqs)
      ? input.faqs
          .map((item) => ({
            q: String(item?.q ?? "").trim(),
            a: String(item?.a ?? "").trim(),
          }))
          .filter((item) => item.q && item.a)
      : [],
    tags: Array.isArray(input.tags)
      ? input.tags.map((s) => String(s)).filter(Boolean)
      : [],
  };
}

export async function readServices(): Promise<RuntimeService[]> {
  try {
    const raw = await readFile(getServicesFilePath(), "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return DEFAULT_SERVICES;

    return parsed
      .map(normalizeService)
      .filter((item) => item.id && item.title)
      .sort((a, b) => a.order - b.order);
  } catch {
    return DEFAULT_SERVICES;
  }
}

export async function readServiceById(id: string) {
  const services = await readServices();
  return services.find((item) => item.id === id) ?? null;
}

export async function writeServices(services: RuntimeService[]) {
  const dir = join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });

  const normalized = services
    .map(normalizeService)
    .filter((item) => item.id && item.title)
    .sort((a, b) => a.order - b.order);

  await writeFile(
    getServicesFilePath(),
    JSON.stringify(normalized, null, 2),
    "utf8"
  );

  return normalized;
}

export async function upsertService(input: {
  id?: string;
  title: string;
  subtitle?: string;
  category: "language" | "abroad";
  order: number;
  icon?: string;
  heroImage?: string;
  officialRegisterUrl?: string;
  summary?: string;
  highlights?: string;
  faqs?: string;
  tags?: string;
}) {
  const services = await readServices();

  const id =
    input.id && input.id.trim()
      ? input.id.trim()
      : slugify(input.title) || crypto.randomUUID().slice(0, 8);

  const nextItem: RuntimeService = {
    id,
    title: input.title.trim(),
    subtitle: String(input.subtitle ?? "").trim(),
    category: input.category,
    order: Number(input.order),
    icon: String(input.icon ?? "").trim(),
    heroImage: String(input.heroImage ?? "").trim(),
    officialRegisterUrl: String(input.officialRegisterUrl ?? "").trim(),
    summary: String(input.summary ?? "").trim(),
    highlights: String(input.highlights ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
    faqs: String(input.faqs ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("|");
        return {
          q: String(parts[0] ?? "").trim(),
          a: String(parts[1] ?? "").trim(),
        };
      })
      .filter((item) => item.q && item.a),
    tags: String(input.tags ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };

  const index = services.findIndex((item) => item.id === id);

  if (index >= 0) {
    services[index] = nextItem;
  } else {
    services.push(nextItem);
  }

  return writeServices(services);
}

export async function deleteService(id: string) {
  const services = await readServices();
  const next = services.filter((item) => item.id !== id);
  return writeServices(next);
}