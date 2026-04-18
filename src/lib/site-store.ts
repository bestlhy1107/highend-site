import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeSiteSettings = {
  companyName: string;
  slogan: string;
  phone: string;
  email: string;
  wechat: string;
};

const DEFAULT_SITE: RuntimeSiteSettings = {
  companyName: "Wanhe Education",
  slogan: "高分出分 · 名师指导 · 留学申请一站式",
  phone: "待填写",
  email: "待填写",
  wechat: "待填写",
};

function getSiteFilePath() {
  return join(process.cwd(), "data", "site.json");
}

export async function readSiteSettings(): Promise<RuntimeSiteSettings> {
  try {
    const filePath = getSiteFilePath();
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      companyName: parsed.companyName ?? DEFAULT_SITE.companyName,
      slogan: parsed.slogan ?? DEFAULT_SITE.slogan,
      phone: parsed.phone ?? DEFAULT_SITE.phone,
      email: parsed.email ?? DEFAULT_SITE.email,
      wechat: parsed.wechat ?? DEFAULT_SITE.wechat,
    };
  } catch {
    return DEFAULT_SITE;
  }
}

export async function writeSiteSettings(input: Partial<RuntimeSiteSettings>) {
  const filePath = getSiteFilePath();
  const dir = join(process.cwd(), "data");

  await mkdir(dir, { recursive: true });

  const current = await readSiteSettings();

  const next: RuntimeSiteSettings = {
    companyName: input.companyName ?? current.companyName,
    slogan: input.slogan ?? current.slogan,
    phone: input.phone ?? current.phone,
    email: input.email ?? current.email,
    wechat: input.wechat ?? current.wechat,
  };

  await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}