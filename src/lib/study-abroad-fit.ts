import {
  type StudyAbroadAdmissionsInsight,
  type StudyAbroadAdmissionsProfile,
  readStudyAbroadCachedAdmissionsInsights,
} from "./study-abroad-admissions";
import { readStudyAbroadFinderPrograms } from "./study-abroad-catalog-store";

export type StudyAbroadFitInput = {
  gpaProfile?: string;
  languageProfile?: string;
};

export type StudyAbroadFitPreview = {
  programId: string;
  status: "match" | "review" | "risk";
  headline: string;
  details: string[];
  admissionsProfile: StudyAbroadAdmissionsProfile;
  extractionStatus: "ok" | "partial" | "unavailable";
};

type AdmissionsSnapshotLike = {
  extractedAt?: string;
  extractionStatus?: "ok" | "partial" | "unavailable";
  gpaMin?: number | null;
  gpaScale?: string;
  ieltsMin?: number | null;
  toeflMin?: number | null;
  duolingoMin?: number | null;
  pteMin?: number | null;
  greStatus?: "required" | "recommended" | "optional" | "unknown";
  gmatStatus?: "required" | "recommended" | "optional" | "unknown";
  workExperienceYears?: number | null;
};

function parseUserGpaFloor(value: string) {
  switch (String(value || "").trim()) {
    case "3.7+":
      return 3.7;
    case "3.5-3.69":
      return 3.5;
    case "3.3-3.49":
      return 3.3;
    case "3.0-3.29":
      return 3.0;
    case "under-3.0":
      return 0;
    default:
      return null;
  }
}

function parseLanguageProfile(value: string) {
  const text = String(value || "").trim();
  if (!text) return null;

  const match = text.match(/^(IELTS|TOEFL|Duolingo|PTE)\s+(\d+(?:\.\d+)?)$/i);
  if (!match) return null;

  return {
    test: match[1].toLowerCase(),
    score: Number(match[2]),
    label: text,
  };
}

function compareGpa(profile: StudyAbroadAdmissionsProfile, gpaProfile: string) {
  const userFloor = parseUserGpaFloor(gpaProfile);
  if (userFloor === null) return null;
  if (!profile.gpaMin) {
    return {
      status: "unknown" as const,
      detail: "GPA 要求待核对",
    };
  }

  if (userFloor >= profile.gpaMin) {
    return {
      status: "meets" as const,
      detail: `GPA 预估匹配：页面抓到最低 ${profile.gpaMin.toFixed(1)}/${profile.gpaScale || "4.0"}`,
    };
  }

  return {
    status: "below" as const,
    detail: `GPA 预估偏紧：页面抓到最低 ${profile.gpaMin.toFixed(1)}/${profile.gpaScale || "4.0"}`,
  };
}

function compareLanguage(profile: StudyAbroadAdmissionsProfile, languageProfile: string) {
  const user = parseLanguageProfile(languageProfile);
  if (!user) return null;

  const requirementMap = {
    ielts: profile.ieltsMin,
    toefl: profile.toeflMin,
    duolingo: profile.duolingoMin,
    pte: profile.pteMin,
  } as const;

  const matchedRequirement = requirementMap[user.test as keyof typeof requirementMap];
  const anyRequirement = Object.values(requirementMap).some(Boolean);

  if (!matchedRequirement) {
    return {
      status: "unknown" as const,
      detail: anyRequirement
        ? `语言要求待核对：当前填写 ${user.label}，页面暂未抓到同类型分数线`
        : "语言要求待核对",
    };
  }

  if (user.score >= matchedRequirement) {
    return {
      status: "meets" as const,
      detail: `语言预估匹配：页面抓到 ${user.label.split(" ")[0]} ${matchedRequirement}`,
    };
  }

  return {
    status: "below" as const,
    detail: `语言预估偏紧：页面抓到 ${user.label.split(" ")[0]} ${matchedRequirement}`,
  };
}

function buildHeadline(status: "match" | "review" | "risk") {
  if (status === "match") return "当前背景大致匹配";
  if (status === "risk") return "当前背景可能偏紧";
  return "当前背景待核对";
}

function computeOverallStatus(input: {
  gpaResult: ReturnType<typeof compareGpa>;
  languageResult: ReturnType<typeof compareLanguage>;
}) {
  const { gpaResult, languageResult } = input;
  const items = [gpaResult, languageResult].filter(Boolean);

  if (items.some((item) => item?.status === "below")) {
    return "risk" as const;
  }

  if (items.length && items.every((item) => item?.status === "meets")) {
    return "match" as const;
  }

  return "review" as const;
}

function buildPreviewFromInsight(
  insight: Pick<
    StudyAbroadAdmissionsInsight,
    "programId" | "admissionsProfile" | "extractionStatus"
  >,
  input: StudyAbroadFitInput
) {
  const gpaResult = compareGpa(insight.admissionsProfile, input.gpaProfile ?? "");
  const languageResult = compareLanguage(
    insight.admissionsProfile,
    input.languageProfile ?? ""
  );
  const status = computeOverallStatus({ gpaResult, languageResult });
  const details = [gpaResult?.detail, languageResult?.detail]
    .filter(Boolean)
    .slice(0, 3) as string[];

  if (insight.extractionStatus === "partial") {
    details.push("当前只抓到部分官网门槛字段，建议继续查看要求摘要。");
  }

  if (insight.extractionStatus === "unavailable") {
    details.push("当前还没有抓到稳定的官网门槛字段，建议先查看要求摘要。");
  }

  if (!details.length) {
    details.push("当前页面还没有抓到足够稳定的成绩要求字段，建议继续查看要求摘要。");
  }

  return {
    programId: insight.programId,
    status,
    headline: buildHeadline(status),
    details,
    admissionsProfile: insight.admissionsProfile,
    extractionStatus: insight.extractionStatus,
  } satisfies StudyAbroadFitPreview;
}

export function buildStudyAbroadFitPreviewFromInsight(
  insight: Pick<
    StudyAbroadAdmissionsInsight,
    "programId" | "admissionsProfile" | "extractionStatus"
  >,
  input: StudyAbroadFitInput
) {
  return buildPreviewFromInsight(insight, input);
}

export async function buildStudyAbroadFitPreview(
  programId: string,
  input: StudyAbroadFitInput
) {
  const previews = await buildStudyAbroadFitPreviews([programId], input);
  return previews[0] ?? null;
}

export async function buildStudyAbroadFitPreviews(
  programIds: string[],
  input: StudyAbroadFitInput
) {
  const ids = Array.from(new Set(programIds.filter(Boolean))).slice(0, 8);
  if (!ids.length) {
    return [];
  }

  const finderPrograms = await readStudyAbroadFinderPrograms();
  const programMap = new Map(
    finderPrograms
      .filter((program) => ids.includes(program.id))
      .map((program) => [program.id, program])
  );
  const previewMap = new Map<string, StudyAbroadFitPreview>();

  const buildPreviewFromSnapshot = (
    programId: string,
    snapshot: AdmissionsSnapshotLike
  ) =>
    buildPreviewFromInsight(
      {
        programId,
        admissionsProfile: {
          gpaMin: snapshot.gpaMin ?? null,
          gpaScale: snapshot.gpaScale ?? "",
          ieltsMin: snapshot.ieltsMin ?? null,
          toeflMin: snapshot.toeflMin ?? null,
          duolingoMin: snapshot.duolingoMin ?? null,
          pteMin: snapshot.pteMin ?? null,
          greStatus: snapshot.greStatus ?? "unknown",
          gmatStatus: snapshot.gmatStatus ?? "unknown",
          workExperienceYears: snapshot.workExperienceYears ?? null,
          academicSignals: [],
          languageSignals: [],
          testSignals: [],
        },
        extractionStatus: snapshot.extractionStatus ?? "unavailable",
      },
      input
    );

  ids.forEach((programId) => {
    const snapshot = programMap.get(programId)?.admissionsSnapshot;
    if (!snapshot?.extractedAt) {
      return;
    }

    previewMap.set(programId, buildPreviewFromSnapshot(programId, snapshot));
  });

  const missingIds = ids.filter((programId) => !previewMap.has(programId));
  if (missingIds.length) {
    const cachedInsights = await readStudyAbroadCachedAdmissionsInsights(missingIds);
    cachedInsights.forEach((insight) => {
      previewMap.set(insight.programId, buildPreviewFromInsight(insight, input));
    });
  }

  return ids
    .map((programId) => previewMap.get(programId) ?? null)
    .filter((item): item is StudyAbroadFitPreview => Boolean(item));
}
