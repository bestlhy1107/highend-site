import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import { writeSiteSettings } from "../lib/site-store";
import { upsertTeacher, deleteTeacher } from "../lib/teachers-store";
import { upsertService, deleteService } from "../lib/services-store";
import { upsertExam, deleteExam } from "../lib/exams-store";
import {
  upsertScore,
  deleteScore,
  renameScoreExamType,
} from "../lib/scores-store";
import {
  createLead,
  updateLeadById,
  deleteLeadById,
  type LeadStatus,
} from "../lib/leads-store";
import { sendBusinessMail } from "../lib/mail";
import { syncUsStudyAbroadCatalog } from "../lib/study-abroad-us-import";
import { syncGlobalStudyAbroadUniversityCatalog } from "../lib/study-abroad-global-import";
import { syncUkStudyAbroadPilotPrograms } from "../lib/study-abroad-uk-seed";
import { executeStudyAbroadCatalogSync } from "../lib/study-abroad-catalog-sync";
import {
  executeStudyAbroadAdmissionsCampaignCadence,
  executeStudyAbroadAdmissionsCoverageRoadmap,
  executeStudyAbroadAdmissionsCoverageSprint,
  executeStudyAbroadAdmissionsCountryTargetPlan,
  updateStudyAbroadAdmissionsStrategy,
  smartWarmStudyAbroadAdmissionsCoverage,
  syncStudyAbroadAdmissionsSnapshots,
  warmStudyAbroadAdmissionsCoverage,
} from "../lib/study-abroad-admissions-sync";
import {
  appendStudyAbroadReviewEntryHistory,
  collectStudyAbroadReviewAvoidDomainSuggestions,
  readStudyAbroadReviewQueue,
  updateStudyAbroadReviewEntryNote,
  updateStudyAbroadReviewEntryStatus,
} from "../lib/study-abroad-review-queue";
import {
  importStudyAbroadReviewCandidate,
  importStudyAbroadReviewCandidatesByCredibility,
} from "../lib/study-abroad-review-import";
import {
  createStudyAbroadSearchAvoidRulesForDomains,
  createStudyAbroadSearchAvoidRule,
  readStudyAbroadSearchBlocklist,
  updateStudyAbroadSearchAvoidRuleStatus,
} from "../lib/study-abroad-search-governance";
import { updateStudyAbroadSearchExecutionPlanStatus } from "../lib/study-abroad-search-execution-plan";

const ADMIN_USERNAME =
  import.meta.env?.ADMIN_USERNAME || process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD =
  import.meta.env?.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "";

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

    const appointmentTypeLabel =
      input.appointmentType === "trial" ? "预约试听" : "预约咨询";

    emailSent = await sendBusinessMail({
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

      context.session?.set("adminUser", {
        username: input.username,
        loginAt: new Date().toISOString(),
      });

      return { ok: true, message: "登录成功" };
    },
  }),

  adminLogout: defineAction({
    accept: "form",
    handler: async (_input, context) => {
      context.session?.destroy();
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
      consultTeacherName: z.string().optional(),
      consultTeacherAvatar: z.string().optional(),
      consultStatusText: z.string().optional(),
      consultWelcomeMessage: z.string().optional(),
      consultCountryPrompt: z.string().optional(),
      consultCountryOptions: z.string().optional(),
      consultStagePrompt: z.string().optional(),
      consultStageOptions: z.string().optional(),
      consultContactMessage: z.string().optional(),
      consultIdleMessage: z.string().optional(),
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

  saveScore: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().optional(),
      exam: z.string().min(1, "请选择或填写考试类型"),
      scoreText: z.string().min(2, "请输入出分标题"),
      highlight: z.string().optional(),
      date: z.string().optional(),
      image: z.string().min(1, "请填写或上传图片"),
      order: z.coerce.number().min(0, "请输入正确排序"),
      tags: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await upsertScore(input);
      return {
        ok: true,
        message: "出分案例已保存",
      };
    },
  }),

  renameScoreExam: defineAction({
    accept: "form",
    input: z.object({
      fromExam: z.string().min(1, "请选择当前考试类型"),
      nextExam: z.string().min(1, "请输入新的考试类型"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await renameScoreExamType(input.fromExam, input.nextExam);
      return {
        ok: true,
        message: "考试类型已更新",
      };
    },
  }),

  removeScore: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少出分案例 ID"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      await deleteScore(input.id);
      return {
        ok: true,
        message: "出分案例已删除",
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

  syncUsStudyAbroadCatalog: defineAction({
    accept: "form",
    input: z.object({
      maxPages: z.coerce.number().min(1).max(30).optional(),
      perPage: z.coerce.number().min(20).max(100).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return syncUsStudyAbroadCatalog({
        maxPages: input.maxPages,
        perPage: input.perPage,
      });
    },
  }),

  syncGlobalStudyAbroadUniversities: defineAction({
    accept: "form",
    input: z.object({}),
    handler: async (_input, context) => {
      await requireAdmin(context);
      return syncGlobalStudyAbroadUniversityCatalog();
    },
  }),

  syncUkStudyAbroadPilotPrograms: defineAction({
    accept: "form",
    input: z.object({}),
    handler: async (_input, context) => {
      await requireAdmin(context);
      return syncUkStudyAbroadPilotPrograms();
    },
  }),

  syncStudyAbroadCatalogSources: defineAction({
    accept: "form",
    input: z.object({
      includeGlobal: z.coerce.boolean().optional(),
      includeUs: z.coerce.boolean().optional(),
      includeUk: z.coerce.boolean().optional(),
      usMaxPages: z.coerce.number().min(1).max(30).optional(),
      usPerPage: z.coerce.number().min(20).max(100).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return executeStudyAbroadCatalogSync({
        includeGlobal: input.includeGlobal,
        includeUs: input.includeUs,
        includeUk: input.includeUk,
        usMaxPages: input.usMaxPages,
        usPerPage: input.usPerPage,
        mode: "manual",
        trigger: "dashboard",
      });
    },
  }),

  syncStudyAbroadAdmissionsSnapshots: defineAction({
    accept: "form",
    input: z.object({
      maxPrograms: z.coerce.number().min(1).max(40).optional(),
      mode: z.enum(["missing-first", "refresh-all"]).optional(),
      country: z.string().optional(),
      degree: z.enum(["本科", "硕士", "博士"]).optional().or(z.literal("")),
      major: z.string().optional(),
      specialization: z.string().optional(),
      recordHistory: z.coerce.boolean().optional(),
      executionPlanId: z.string().optional(),
      executionPlanLabel: z.string().optional(),
      actionSummary: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      const result = await syncStudyAbroadAdmissionsSnapshots({
        maxPrograms: input.maxPrograms,
        mode: input.mode,
        country: input.country,
        degree: input.degree,
        major: input.major,
        specialization: input.specialization,
        recordHistory: input.recordHistory,
      });

      const actionFailed =
        result && typeof result === "object" && "ok" in result && result.ok === false;
      if (!actionFailed && (input.executionPlanId || input.executionPlanLabel)) {
        await updateStudyAbroadSearchExecutionPlanStatus({
          id: input.executionPlanId,
          label: input.executionPlanLabel,
          status: "in_progress",
          country: input.country,
          degree: input.degree,
          major: input.major,
          specialization: input.specialization,
          actionSummary:
            input.actionSummary ||
            (typeof result === "object" && result && "message" in result
              ? String(result.message || "").trim()
              : "已执行一轮补门槛同步"),
        });
      }

      return result;
    },
  }),

  warmStudyAbroadAdmissionsCoverage: defineAction({
    accept: "form",
    input: z.object({
      presetId: z.string().optional(),
      maxPresets: z.coerce.number().min(1).max(12).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return warmStudyAbroadAdmissionsCoverage({
        presetId: input.presetId,
        maxPresets: input.maxPresets,
      });
    },
  }),

  smartWarmStudyAbroadAdmissionsCoverage: defineAction({
    accept: "form",
    input: z.object({
      recommendationId: z.string().optional(),
      maxRecommendations: z.coerce.number().min(1).max(10).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return smartWarmStudyAbroadAdmissionsCoverage({
        recommendationId: input.recommendationId,
        maxRecommendations: input.maxRecommendations,
      });
    },
  }),

  executeStudyAbroadAdmissionsCountryTargetPlan: defineAction({
    accept: "form",
    input: z.object({
      country: z.string().optional(),
      degree: z.enum(["本科", "硕士", "博士"]).optional().or(z.literal("")),
      major: z.string().optional(),
      specialization: z.string().optional(),
      maxCountries: z.coerce.number().min(1).max(6).optional(),
      maxFocusPerCountry: z.coerce.number().min(1).max(4).optional(),
      executionPlanId: z.string().optional(),
      executionPlanLabel: z.string().optional(),
      actionSummary: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      const result = await executeStudyAbroadAdmissionsCountryTargetPlan({
        country: input.country,
        degree: input.degree,
        maxCountries: input.maxCountries,
        maxFocusPerCountry: input.maxFocusPerCountry,
      });

      const actionFailed =
        result && typeof result === "object" && "ok" in result && result.ok === false;
      if (!actionFailed && (input.executionPlanId || input.executionPlanLabel)) {
        await updateStudyAbroadSearchExecutionPlanStatus({
          id: input.executionPlanId,
          label: input.executionPlanLabel,
          status: "in_progress",
          country: input.country,
          degree: input.degree,
          major: input.major,
          specialization: input.specialization,
          actionSummary:
            input.actionSummary ||
            (typeof result === "object" && result && "message" in result
              ? String(result.message || "").trim()
              : "已执行国家目标推进"),
        });
      }

      return result;
    },
  }),

  executeStudyAbroadAdmissionsCoverageSprint: defineAction({
    accept: "form",
    input: z.object({
      degree: z.enum(["本科", "硕士", "博士"]).optional().or(z.literal("")),
      maxCountries: z.coerce.number().min(1).max(4).optional(),
      maxFocusPerCountry: z.coerce.number().min(1).max(3).optional(),
      maxRecommendations: z.coerce.number().min(1).max(6).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return executeStudyAbroadAdmissionsCoverageSprint({
        degree: input.degree,
        maxCountries: input.maxCountries,
        maxFocusPerCountry: input.maxFocusPerCountry,
        maxRecommendations: input.maxRecommendations,
      });
    },
  }),

  executeStudyAbroadAdmissionsCoverageRoadmap: defineAction({
    accept: "form",
    input: z.object({
      degree: z.enum(["本科", "硕士", "博士"]).optional().or(z.literal("")),
      rounds: z.coerce.number().min(1).max(5).optional(),
      maxCountries: z.coerce.number().min(1).max(4).optional(),
      maxFocusPerCountry: z.coerce.number().min(1).max(3).optional(),
      maxRecommendations: z.coerce.number().min(1).max(6).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return executeStudyAbroadAdmissionsCoverageRoadmap({
        degree: input.degree,
        rounds: input.rounds,
        maxCountries: input.maxCountries,
        maxFocusPerCountry: input.maxFocusPerCountry,
        maxRecommendations: input.maxRecommendations,
      });
    },
  }),

  executeStudyAbroadAdmissionsCampaignCadence: defineAction({
    accept: "form",
    input: z.object({
      degree: z.enum(["本科", "硕士", "博士"]).optional().or(z.literal("")),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return executeStudyAbroadAdmissionsCampaignCadence({
        degree: input.degree,
      });
    },
  }),

  updateStudyAbroadAdmissionsStrategy: defineAction({
    accept: "form",
    input: z.object({
      focusCooldownHours: z.coerce.number().min(1).max(168),
      countryCooldownHours: z.coerce.number().min(1).max(168),
      smartRecommendationCooldownHours: z.coerce.number().min(1).max(336),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return updateStudyAbroadAdmissionsStrategy({
        focusCooldownHours: input.focusCooldownHours,
        countryCooldownHours: input.countryCooldownHours,
        smartRecommendationCooldownHours: input.smartRecommendationCooldownHours,
      });
    },
  }),

  updateStudyAbroadReviewQueueStatus: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少候选任务 ID"),
      status: z.enum(["reviewed", "discarded"]),
      note: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return updateStudyAbroadReviewEntryStatus({
        id: input.id,
        status: input.status,
        note: input.note,
      });
    },
  }),

  updateStudyAbroadReviewEntryNote: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少候选任务 ID"),
      note: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return updateStudyAbroadReviewEntryNote({
        id: input.id,
        note: input.note || "",
      });
    },
  }),

  importStudyAbroadReviewCandidate: defineAction({
    accept: "form",
    input: z.object({
      entryId: z.string().min(1, "缺少候选任务 ID"),
      candidateLink: z.string().url("缺少候选链接"),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      const result = await importStudyAbroadReviewCandidate({
        entryId: input.entryId,
        candidateLink: input.candidateLink,
      });

      if (result.ok) {
        await appendStudyAbroadReviewEntryHistory({
          id: input.entryId,
          action: result.created ? "导入正式项目" : "尝试导入正式项目",
          note: result.message,
        });
      }

      return result;
    },
  }),

  importStudyAbroadReviewCandidatesByCredibility: defineAction({
    accept: "form",
    input: z.object({
      entryId: z.string().min(1, "缺少候选任务 ID"),
      credibilityMode: z.enum(["high", "high-medium", "all"]),
      maxCandidates: z.coerce.number().int().min(1).max(10).optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      const result = await importStudyAbroadReviewCandidatesByCredibility({
        entryId: input.entryId,
        credibilityMode: input.credibilityMode,
        maxCandidates: input.maxCandidates,
      });

      if (result.ok) {
        await appendStudyAbroadReviewEntryHistory({
          id: input.entryId,
          action:
            input.credibilityMode === "high-medium"
              ? "批量导入高+中可信候选"
              : input.credibilityMode === "all"
                ? "批量导入全部候选"
                : "批量导入高可信候选",
          note: result.message,
        });
      }

      return result;
    },
  }),

  createStudyAbroadReviewBatchAvoidRules: defineAction({
    accept: "form",
    input: z.object({
      entryId: z.string().min(1, "缺少候选任务 ID"),
      credibilityMode: z.enum(["watch", "watch-medium"]),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      const [queue, blocklist] = await Promise.all([
        readStudyAbroadReviewQueue(),
        readStudyAbroadSearchBlocklist(),
      ]);
      const entry = queue.find((item) => item.id === input.entryId);

      if (!entry) {
        return {
          ok: false,
          message: "这条候选任务不存在，暂时无法批量规避来源。",
        };
      }

      const suggestions = collectStudyAbroadReviewAvoidDomainSuggestions(entry, {
        credibilityMode: input.credibilityMode,
        blockedDomains: blocklist.blockedDomains,
        minOccurrences: 2,
      });

      if (!suggestions.length) {
        return {
          ok: false,
          message:
            input.credibilityMode === "watch-medium"
              ? "当前没有符合条件的中低可信重复来源可批量规避。"
              : "当前没有符合条件的待核对重复来源可批量规避。",
        };
      }

      const result = await createStudyAbroadSearchAvoidRulesForDomains({
        domains: suggestions,
        source: "candidate",
        reason:
          input.credibilityMode === "watch-medium"
            ? "管理员批量规避中低可信且重复出现的候选来源"
            : "管理员批量规避待核对且重复出现的候选来源",
      });

      if (result.ok) {
        await appendStudyAbroadReviewEntryHistory({
          id: input.entryId,
          action:
            input.credibilityMode === "watch-medium"
              ? "批量规避中低可信重复来源"
              : "批量规避待核对重复来源",
          note: result.message,
        });
      }

      return result;
    },
  }),

  createStudyAbroadSearchAvoidRule: defineAction({
    accept: "form",
    input: z.object({
      targetType: z.enum(["program", "link", "domain"]),
      source: z.enum(["verified", "candidate", "manual"]).optional(),
      label: z.string().optional(),
      reason: z.string().optional(),
      programId: z.string().optional(),
      link: z.string().optional(),
      domain: z.string().optional(),
      sourceSessionId: z.string().optional(),
      reviewEntryId: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);

      if (input.targetType === "program" && !input.programId) {
        return {
          ok: false,
          message: "缺少正式项目 ID，暂时无法加入规避名单。",
        };
      }

      if (input.targetType === "link" && !input.link) {
        return {
          ok: false,
          message: "缺少链接，暂时无法加入规避名单。",
        };
      }

      if (input.targetType === "domain" && !input.domain && !input.link) {
        return {
          ok: false,
          message: "缺少域名或链接，暂时无法加入规避名单。",
        };
      }

      const result = await createStudyAbroadSearchAvoidRule({
        targetType: input.targetType,
        source: input.source,
        label: input.label,
        reason: input.reason,
        programId: input.programId,
        link: input.link,
        domain: input.domain,
        sourceSessionId: input.sourceSessionId,
      });

      if (result.ok && input.reviewEntryId) {
        await appendStudyAbroadReviewEntryHistory({
          id: input.reviewEntryId,
          action:
            input.targetType === "domain"
              ? "规避整个站点"
              : input.targetType === "program"
                ? "规避正式项目"
                : "规避单条链接",
          note: result.message,
        });
      }

      return result;
    },
  }),

  updateStudyAbroadSearchAvoidRuleStatus: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().min(1, "缺少规避规则 ID"),
      status: z.enum(["active", "inactive"]),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return updateStudyAbroadSearchAvoidRuleStatus({
        id: input.id,
        status: input.status,
      });
    },
  }),

  updateStudyAbroadSearchExecutionPlanStatus: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().optional(),
      label: z.string().optional(),
      status: z.enum(["pending", "in_progress", "completed"]),
      country: z.string().optional(),
      degree: z.enum(["本科", "硕士", "博士"]).optional().or(z.literal("")),
      major: z.string().optional(),
      specialization: z.string().optional(),
      actionSummary: z.string().optional(),
    }),
    handler: async (input, context) => {
      await requireAdmin(context);
      return updateStudyAbroadSearchExecutionPlanStatus({
        id: input.id,
        label: input.label,
        status: input.status,
        country: input.country,
        degree: input.degree,
        major: input.major,
        specialization: input.specialization,
        actionSummary: input.actionSummary,
      });
    },
  }),
};
