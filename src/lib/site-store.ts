import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type RuntimeSiteSettings = {
  companyName: string;
  slogan: string;
  phone: string;
  email: string;
  wechat: string;
  consultTeacherName: string;
  consultTeacherAvatar: string;
  consultStatusText: string;
  consultWelcomeMessage: string;
  consultCountryPrompt: string;
  consultCountryOptions: string;
  consultStagePrompt: string;
  consultStageOptions: string;
  consultContactMessage: string;
  consultIdleMessage: string;
};

const DEFAULT_SITE: RuntimeSiteSettings = {
  companyName: "Wanhe Education",
  slogan: "高分出分 · 名师指导 · 留学申请一站式",
  phone: "待填写",
  email: "待填写",
  wechat: "待填写",
  consultTeacherName: "周老师",
  consultTeacherAvatar: "",
  consultStatusText: "正在为您服务",
  consultWelcomeMessage:
    "亲爱的同学 / 家长您好，欢迎来到留学咨询窗口。我们可以先帮您梳理国家方向、申请阶段和准备时间线。",
  consultCountryPrompt: "您想了解哪个国家或地区的留学呢？",
  consultCountryOptions:
    "美国,英国,澳洲,加拿大,中国港澳,日本,韩国,新加坡,马来西亚",
  consultStagePrompt: "您是想申请哪个阶段留学呢？",
  consultStageOptions: "中学,本科,硕士,博士",
  consultContactMessage:
    "您好，如果对留学申请有什么疑问，比如院校选择、申请条件等，可以留下您意向申请的国家 + 电话 / 微信 / 邮箱，我们会安排专属老师尽快联系您。",
  consultIdleMessage:
    "您也可以直接联系我们的微信或者电话，免费获取 1v1 留学规划指导。微信：{{wechat}} 电话：{{phone}}",
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
      consultTeacherName:
        parsed.consultTeacherName ?? DEFAULT_SITE.consultTeacherName,
      consultTeacherAvatar:
        parsed.consultTeacherAvatar ?? DEFAULT_SITE.consultTeacherAvatar,
      consultStatusText:
        parsed.consultStatusText ?? DEFAULT_SITE.consultStatusText,
      consultWelcomeMessage:
        parsed.consultWelcomeMessage ?? DEFAULT_SITE.consultWelcomeMessage,
      consultCountryPrompt:
        parsed.consultCountryPrompt ?? DEFAULT_SITE.consultCountryPrompt,
      consultCountryOptions:
        parsed.consultCountryOptions ?? DEFAULT_SITE.consultCountryOptions,
      consultStagePrompt:
        parsed.consultStagePrompt ?? DEFAULT_SITE.consultStagePrompt,
      consultStageOptions:
        parsed.consultStageOptions ?? DEFAULT_SITE.consultStageOptions,
      consultContactMessage:
        parsed.consultContactMessage ?? DEFAULT_SITE.consultContactMessage,
      consultIdleMessage:
        parsed.consultIdleMessage ?? DEFAULT_SITE.consultIdleMessage,
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
    consultTeacherName:
      input.consultTeacherName ?? current.consultTeacherName,
    consultTeacherAvatar:
      input.consultTeacherAvatar ?? current.consultTeacherAvatar,
    consultStatusText:
      input.consultStatusText ?? current.consultStatusText,
    consultWelcomeMessage:
      input.consultWelcomeMessage ?? current.consultWelcomeMessage,
    consultCountryPrompt:
      input.consultCountryPrompt ?? current.consultCountryPrompt,
    consultCountryOptions:
      input.consultCountryOptions ?? current.consultCountryOptions,
    consultStagePrompt:
      input.consultStagePrompt ?? current.consultStagePrompt,
    consultStageOptions:
      input.consultStageOptions ?? current.consultStageOptions,
    consultContactMessage:
      input.consultContactMessage ?? current.consultContactMessage,
    consultIdleMessage:
      input.consultIdleMessage ?? current.consultIdleMessage,
  };

  await writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
  return next;
}
