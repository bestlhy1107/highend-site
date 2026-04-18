// src/content.config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const site = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/site" }),
  schema: z
    .object({
      companyName: z.string().optional(),
      slogan: z.string().optional(),
      phone: z.string().optional(),
      email: z.string().optional(),
      wechat: z.string().optional(),
    })
    .passthrough(),
});


const exams = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/exams" }),
  schema: z.object({
    title: z.string(),
    subtitle: z.string().optional().default(""),
    order: z.number().optional().default(999),
    tags: z.array(z.string()).optional().default([]),
  }).passthrough(),
});



const services = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/services" }),
  schema: z
    .object({
      title: z.string(),
      subtitle: z.string().optional().default(""),
      icon: z.string().optional(),
      order: z.number().optional().default(999),
      category: z.enum(["abroad", "language"]).optional().default("language"),
      heroImage: z.string().optional(),
      officialRegisterUrl: z.string().url().optional(),
      highlights: z.array(z.string()).optional().default([]),
      faqs: z.array(z.object({ q: z.string(), a: z.string() })).optional().default([]),
      tags: z.array(z.string()).optional().default([]),
    })
    .passthrough(),
});

const teachers = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/teachers" }),
  schema: z
    .object({
      // ✅ 建议必填：TeacherShowcase 不再报 “possibly undefined”
      name: z.string(),
      title: z.string().optional().default(""),
      order: z.number().optional().default(999),
      avatar: z.string().optional(),
      intro: z.string().optional().default(""),
      specialties: z.array(z.string()).optional().default([]),
      badges: z.array(z.string()).optional().default([]),
    })
    .passthrough(),
});

const scores = defineCollection({
  loader: glob({ pattern: "**/*.json", base: "./src/content/scores" }),
  schema: z
    .object({
      exam: z.string().optional().default(""),
      // ✅ 明确字段：ScoreCarousel 用它展示/做 alt
      scoreText: z.string(),
      highlight: z.string().optional().default(""),
      date: z.string().optional().default(""),
      // ✅ 建议必填：没有图就没法展示
      image: z.string(),
      tags: z.array(z.string()).optional().default([]),
    })
    .passthrough(),
});

export const collections = { site, exams, services, teachers, scores };
