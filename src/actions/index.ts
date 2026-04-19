import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import nodemailer from "nodemailer";
import { writeSiteSettings } from "../lib/site-store";
import { upsertTeacher, deleteTeacher } from "../lib/teachers-store";
import { upsertService, deleteService } from "../lib/services-store";
import { upsertExam, deleteExam } from "../lib/exams-store";
import {
  createLead,
  updateLeadById,
  deleteLeadById,
  type LeadStatus,
} from "../lib/leads-store";

const SMTP_HOST = import.meta.env.SMTP_HOST;
const SMTP_PORT = import.meta.env.SMTP_PORT;
const SMTP_SECURE = import.meta.env.SMTP_SECURE;
const SMTP_USER = import.meta.env.SMTP_USER;
const SMTP_PASS = import.meta.env.SMTP_PASS;
const LEAD_TO_EMAIL = import.meta.env.LEAD_TO_EMAIL;
const MAIL_FROM = import.meta.env.MAIL_FROM;

const ADMIN_USERNAME = import.meta.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = import.meta.env.ADMIN_PASSWORD;

const smtpConfigured =
  !!SMTP_HOST &&
  !!SMTP_PORT &&
  !!SMTP_USER &&
  !!SMTP_PASS;

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: String(SMTP_SECURE).toLowerCase() === "true",
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    })
  : null;

async function requireAdmin(context: {
  session?: {
    get: (key: string) => Promise<any> | any;
  };
}) {
  const adminUser = await context.session?.get("adminUser");

  if (!adminUser) {
    throw new ActionError({
      code: "UNAUTHORIZED",
      message: "请先登录管理员后台",
    });
  }

  return adminUser;
}

export const server = {
contactLead: defineAction({
  accept: "form",
  input: z.object({
    name: z.string().min(2, "请输入姓名"),
    contact: z.string().min(4, "请输入联系方式"),
    appointmentType: z.enum(["trial", "consultation"]),
    examType: z.string().min(1, "请选择考试类型"),
    preferredTime: z.string().min(2, "请输入期望时间段"),
    need: z.string().min(6, "请简单描述你的需求"),
    source: z.string().optional(),
  }),
  handler: async (input) => {
    const submittedAt = new Date().toISOString();

    const savedLead = await createLead({
      name: input.name,
      contact: input.contact,
      appointmentType: input.appointmentType,
      examType: input.examType,
      preferredTime: input.preferredTime,
      need: input.need,
      source: input.source,
    });

    let emailSent = false;

    if (transporter) {
      try {
        const to = LEAD_TO_EMAIL || SMTP_USER;
        const from = MAIL_FROM || SMTP_USER;

        const appointmentTypeLabel =
          input.appointmentType === "trial" ? "预约试听" : "预约咨询";

        await transporter.sendMail({
          from,
          to,
          subject: `【新预约】${input.name} - ${input.examType} - ${input.contact}`,
          text: [
            `线索ID：${savedLead.id}`,
            `姓名：${input.name}`,
            `联系方式：${input.contact}`,
            `预约类型：${appointmentTypeLabel}`,
            `考试类型：${input.examType}`,
            `期望时间：${input.preferredTime}`,
            `需求：${input.need}`,
            `来源：${input.source ?? "homepage"}`,
            `提交时间：${submittedAt}`,
          ].join("\n"),
          html: `
            <h2>收到新的预约表单</h2>
            <p><strong>线索ID：</strong>${savedLead.id}</p>
            <p><strong>姓名：</strong>${input.name}</p>
            <p><strong>联系方式：</strong>${input.contact}</p>
            <p><strong>预约类型：</strong>${appointmentTypeLabel}</p>
            <p><strong>考试类型：</strong>${input.examType}</p>
            <p><strong>期望时间：</strong>${input.preferredTime}</p>
            <p><strong>需求：</strong>${input.need}</p>
            <p><strong>来源：</strong>${input.source ?? "homepage"}</p>
            <p><strong>提交时间：</strong>${submittedAt}</p>
          `,
        });

        emailSent = true;
      } catch (error) {
        console.error("Failed to send lead notification email", error);
      }
    }

    return {
      ok: true,
      message: "预约提交成功，我们会尽快联系你。",
      submittedAt,
      leadId: savedLead.id,
      source: input.source ?? "homepage",
      emailSent,
    };
  },
}),

  adminLogin: defineAction({
    accept: "form",
    input: z.object({
      username: z.string().min(1, "请输入账号"),
      password: z.string().min(1, "请输入密码"),
    }),
    handler: async (input, context) => {
      if (
        !ADMIN_USERNAME ||
        !ADMIN_PASSWORD ||
        input.username !== ADMIN_USERNAME ||
        input.password !== ADMIN_PASSWORD
      ) {
        throw new ActionError({
          code: "UNAUTHORIZED",
          message: "管理员账号或密码错误",
        });
      }

      await context.session?.set("adminUser", {
        username: input.username,
        loginAt: new Date().toISOString(),
      });

      return { ok: true, message: "登录成功" };
    },
  }),

  adminLogout: defineAction({
    accept: "form",
    handler: async (_input, context) => {
      await context.session?.destroy();
      return { ok: true, message: "已退出登录" };
    },
  }),

  updateSiteSettings: defineAction({
    accept: "form",
    input: z.object({
      companyName: z.string().min(2, "请输入公司名称"),
      slogan: z.string().min(4, "请输入站点标语"),
      phone: z.string().min(3, "请输入联系电话"),
      email: z.string().email("请输入正确邮箱"),
      wechat: z.string().min(2, "请输入微信号"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      const saved = await writeSiteSettings(input);
      return {
        ok: true,
        message: "站点信息已更新",
        settings: saved,
      };
    },
  }),

  saveTeacher: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().optional(),
      name: z.string().min(2, "请输入老师姓名"),
      title: z.string().min(2, "请输入老师职位"),
      order: z.coerce.number().min(0, "请输入正确排序"),
      avatar: z.string().optional(),
      intro: z.string().optional(),
      specialties: z.string().optional(),
      badges: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await upsertTeacher(input);
      return {
        ok: true,
        message: "老师信息已保存",
      };
    },
  }),

  removeTeacher: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少老师 ID"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await deleteTeacher(input.id);
      return {
        ok: true,
        message: "老师已删除",
      };
    },
  }),

  saveService: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().optional(),
      title: z.string().min(2, "请输入服务标题"),
      subtitle: z.string().optional(),
      category: z.enum(["language", "abroad"]),
      order: z.coerce.number().min(0, "请输入正确排序"),
      icon: z.string().optional(),
      heroImage: z.string().optional(),
      officialRegisterUrl: z.string().optional(),
      summary: z.string().optional(),
      highlights: z.string().optional(),
      faqs: z.string().optional(),
      tags: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await upsertService(input);
      return {
        ok: true,
        message: "服务信息已保存",
      };
    },
  }),

  removeService: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少服务 ID"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await deleteService(input.id);
      return {
        ok: true,
        message: "服务已删除",
      };
    },
  }),

  saveExam: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().optional(),
      title: z.string().min(2, "请输入考试标题"),
      subtitle: z.string().optional(),
      order: z.coerce.number().min(0, "请输入正确排序"),
      summary: z.string().optional(),
      highlights: z.string().optional(),
      faqs: z.string().optional(),
      tags: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await upsertExam(input);
      return {
        ok: true,
        message: "考试信息已保存",
      };
    },
  }),

  removeExam: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少考试 ID"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await deleteExam(input.id);
      return {
        ok: true,
        message: "考试已删除",
      };
    },
  }),

  updateLead: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少线索 ID"),
      status: z.enum(["new", "contacted", "done", "invalid"]),
      adminNote: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);

      const saved = await updateLeadById({
        id: input.id,
        status: input.status as LeadStatus,
        adminNote: input.adminNote ?? "",
      });

      return {
        ok: true,
        message: "咨询记录已更新",
        lead: saved,
      };
    },
  }),

  deleteLead: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少线索 ID"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await deleteLeadById(input.id);

      return {
        ok: true,
        message: "咨询记录已删除",
      };
    },
  }),
};
