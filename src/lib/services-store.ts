import {
  compareByOrder,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import {
  normalizeFaqArray,
  normalizeStringArray,
  parseFaqLines,
  slugify,
  splitCsv,
  splitLines,
} from "./text-fields";

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
    highlights: normalizeStringArray(input.highlights),
    faqs: normalizeFaqArray(input.faqs),
    tags: normalizeStringArray(input.tags),
  };
}

function isValidService(item: RuntimeService) {
  return Boolean(item.id && item.title);
}

export async function readServices(): Promise<RuntimeService[]> {
  return readJsonArrayFile({
    fileName: "services.json",
    fallback: DEFAULT_SERVICES,
    normalize: normalizeService,
    isValid: isValidService,
    compare: compareByOrder,
  });
}

export async function readServiceById(id: string) {
  const services = await readServices();
  return services.find((item) => item.id === id) ?? null;
}

export async function writeServices(services: RuntimeService[]) {
  return writeJsonArrayFile(services, {
    fileName: "services.json",
    normalize: normalizeService,
    isValid: isValidService,
    compare: compareByOrder,
  });
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
    highlights: splitLines(input.highlights),
    faqs: parseFaqLines(input.faqs),
    tags: splitCsv(input.tags),
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
