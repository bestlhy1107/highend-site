// src/content.config.ts
import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

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

export const collections = { scores };
