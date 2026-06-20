import {
  compareByOrder,
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import { normalizeStringArray, slugify, splitCsv } from "./text-fields";

export type RuntimeOffer = {
  id: string;
  country: string;
  university: string;
  universityZh: string;
  program: string;
  degree: string;
  result: string;
  date: string;
  studentProfile: string;
  timeline: string[];
  highlights: string[];
  tags: string[];
  order: number;
};

const DEFAULT_OFFERS: RuntimeOffer[] = [
  {
    id: "offer-uk-ucl-digital-finance",
    country: "英国",
    university: "University College London",
    universityZh: "伦敦大学学院",
    program: "MSc Banking and Digital Finance",
    degree: "硕士",
    result: "2025 Fall Offer",
    date: "2025-04",
    studentProfile: "双非院校 · 金融背景 · IELTS 7.0",
    timeline: ["9 月定校", "10 月递交", "次年 4 月收获 Offer"],
    highlights: ["用数字金融实习串起申请主线", "文书突出量化分析和金融科技项目经历"],
    tags: ["英国", "金融科技", "UCL"],
    order: 1,
  },
  {
    id: "offer-sg-nus-ba",
    country: "新加坡",
    university: "National University of Singapore",
    universityZh: "新加坡国立大学",
    program: "MSc Business Analytics",
    degree: "硕士",
    result: "2026 Spring Offer",
    date: "2026-01",
    studentProfile: "985 院校 · 统计背景 · TOEFL 103",
    timeline: ["7 月选校定位", "9 月递交", "次年 1 月录取"],
    highlights: ["项目经历覆盖建模、可视化和业务落地", "面试前集中打磨案例表达"],
    tags: ["新加坡", "商业分析", "数据"],
    order: 2,
  },
];

function normalizeOffer(input: Partial<RuntimeOffer>): RuntimeOffer {
  return {
    id: String(input.id ?? "").trim(),
    country: String(input.country ?? "").trim(),
    university: String(input.university ?? "").trim(),
    universityZh: String(input.universityZh ?? "").trim(),
    program: String(input.program ?? "").trim(),
    degree: String(input.degree ?? "").trim(),
    result: String(input.result ?? "").trim(),
    date: String(input.date ?? "").trim(),
    studentProfile: String(input.studentProfile ?? "").trim(),
    timeline: normalizeStringArray(input.timeline),
    highlights: normalizeStringArray(input.highlights),
    tags: normalizeStringArray(input.tags),
    order: Number(input.order ?? 999),
  };
}

function isValidOffer(offer: RuntimeOffer) {
  return Boolean(
    offer.id &&
      offer.country &&
      offer.university &&
      offer.universityZh &&
      offer.program &&
      offer.result
  );
}

export async function readOffers(): Promise<RuntimeOffer[]> {
  return readJsonArrayFile({
    fileName: "offers.json",
    fallback: DEFAULT_OFFERS,
    normalize: normalizeOffer,
    isValid: isValidOffer,
    compare: compareByOrder,
  });
}

export async function writeOffers(offers: RuntimeOffer[]) {
  return writeJsonArrayFile(offers, {
    fileName: "offers.json",
    normalize: normalizeOffer,
    isValid: isValidOffer,
    compare: compareByOrder,
  });
}

export async function upsertOffer(input: {
  id?: string;
  country: string;
  university: string;
  universityZh: string;
  program: string;
  degree?: string;
  result: string;
  date?: string;
  studentProfile?: string;
  timeline?: string;
  highlights?: string;
  tags?: string;
  order: number;
}) {
  const offers = await readOffers();
  const id =
    input.id && input.id.trim()
      ? input.id.trim()
      : slugify(`${input.universityZh}-${input.program}`) ||
        crypto.randomUUID().slice(0, 8);

  const nextOffer: RuntimeOffer = {
    id,
    country: input.country.trim(),
    university: input.university.trim(),
    universityZh: input.universityZh.trim(),
    program: input.program.trim(),
    degree: String(input.degree ?? "").trim(),
    result: input.result.trim(),
    date: String(input.date ?? "").trim(),
    studentProfile: String(input.studentProfile ?? "").trim(),
    timeline: splitCsv(input.timeline),
    highlights: splitCsv(input.highlights),
    tags: splitCsv(input.tags),
    order: Number(input.order),
  };

  const index = offers.findIndex((offer) => offer.id === id);

  if (index >= 0) {
    offers[index] = nextOffer;
  } else {
    offers.push(nextOffer);
  }

  return writeOffers(offers);
}

export async function deleteOffer(id: string) {
  const offers = await readOffers();
  return writeOffers(offers.filter((offer) => offer.id !== id));
}

export function listOfferCountries(offers: RuntimeOffer[]) {
  return Array.from(
    new Set(offers.map((offer) => offer.country.trim()).filter(Boolean))
  );
}
