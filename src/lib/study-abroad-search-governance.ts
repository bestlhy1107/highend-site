import { randomUUID } from "node:crypto";
import {
  readJsonArrayFile,
  writeJsonArrayFile,
} from "./json-file-store";
import type { StudyAbroadFinderProgram } from "./study-abroad-catalog-store";

export type StudyAbroadSearchAuditResult = {
  id: string;
  source: "verified" | "candidate";
  label: string;
  schoolName: string;
  programName: string;
  country: string;
  degree: string;
  discipline: string;
  link: string;
  displayLink: string;
  provider: string;
  programId: string;
};

export type StudyAbroadSearchAuditEntry = {
  id: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  query: {
    freeText: string;
    country: string;
    major: string;
    specialization: string;
    degree: string;
    budgetTier: string;
    intake: string;
    gpaProfile: string;
    languageProfile: string;
    fitMode: string;
    snapshotQuality: string;
  };
  message: string;
  totalVerifiedCount: number;
  displayedVerifiedCount: number;
  totalUniversityCount: number;
  candidateCount: number;
  pendingReviewCount: number;
  blockedResultCount: number;
  results: StudyAbroadSearchAuditResult[];
};

export type StudyAbroadSearchAvoidRule = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "inactive";
  targetType: "program" | "link" | "domain";
  source: "verified" | "candidate" | "manual";
  label: string;
  reason: string;
  programId: string;
  link: string;
  domain: string;
  sourceSessionId: string;
};

export type StudyAbroadSearchBlocklist = {
  blockedProgramIds: Set<string>;
  blockedLinks: Set<string>;
  blockedDomains: Set<string>;
};

const AUDIT_FILE = "study-abroad-search-audit.json";
const AVOID_RULE_FILE = "study-abroad-search-avoid-rules.json";
const MAX_AUDIT_ENTRIES = 240;
const MAX_RESULTS_PER_AUDIT = 180;

function normalizeText(value?: string) {
  return String(value || "").trim();
}

function normalizeLink(value?: string) {
  try {
    const url = new URL(String(value || "").trim());
    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return String(value || "").trim();
  }
}

function extractDomain(value?: string) {
  try {
    return new URL(String(value || "").trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function buildAuditResultId(input: Partial<StudyAbroadSearchAuditResult>) {
  const source = input.source === "candidate" ? "candidate" : "verified";
  const programId = normalizeText(input.programId);
  const link = normalizeLink(input.link);

  if (source === "verified" && programId) {
    return `${source}:${programId}`;
  }

  if (link) {
    return `${source}:${link}`;
  }

  return `${source}:${randomUUID()}`;
}

function normalizeAuditResult(
  input: Partial<StudyAbroadSearchAuditResult>
): StudyAbroadSearchAuditResult {
  return {
    id: normalizeText(input.id) || buildAuditResultId(input),
    source: input.source === "candidate" ? "candidate" : "verified",
    label: normalizeText(input.label),
    schoolName: normalizeText(input.schoolName),
    programName: normalizeText(input.programName),
    country: normalizeText(input.country),
    degree: normalizeText(input.degree),
    discipline: normalizeText(input.discipline),
    link: normalizeLink(input.link),
    displayLink: normalizeText(input.displayLink),
    provider: normalizeText(input.provider),
    programId: normalizeText(input.programId),
  };
}

function isValidAuditResult(item: StudyAbroadSearchAuditResult) {
  return Boolean(item.id && item.source && (item.link || item.programId));
}

function normalizeAuditEntry(
  input: Partial<StudyAbroadSearchAuditEntry>
): StudyAbroadSearchAuditEntry {
  return {
    id: normalizeText(input.id) || randomUUID(),
    sessionId: normalizeText(input.sessionId) || randomUUID(),
    createdAt: normalizeText(input.createdAt) || new Date().toISOString(),
    updatedAt: normalizeText(input.updatedAt) || new Date().toISOString(),
    query: {
      freeText: normalizeText(input.query?.freeText),
      country: normalizeText(input.query?.country),
      major: normalizeText(input.query?.major),
      specialization: normalizeText(input.query?.specialization),
      degree: normalizeText(input.query?.degree),
      budgetTier: normalizeText(input.query?.budgetTier),
      intake: normalizeText(input.query?.intake),
      gpaProfile: normalizeText(input.query?.gpaProfile),
      languageProfile: normalizeText(input.query?.languageProfile),
      fitMode: normalizeText(input.query?.fitMode),
      snapshotQuality: normalizeText(input.query?.snapshotQuality),
    },
    message: normalizeText(input.message),
    totalVerifiedCount: Number(input.totalVerifiedCount) || 0,
    displayedVerifiedCount: Number(input.displayedVerifiedCount) || 0,
    totalUniversityCount: Number(input.totalUniversityCount) || 0,
    candidateCount: Number(input.candidateCount) || 0,
    pendingReviewCount: Number(input.pendingReviewCount) || 0,
    blockedResultCount: Number(input.blockedResultCount) || 0,
    results: Array.isArray(input.results)
      ? input.results
          .map(normalizeAuditResult)
          .filter(isValidAuditResult)
          .slice(0, MAX_RESULTS_PER_AUDIT)
      : [],
  };
}

function isValidAuditEntry(entry: StudyAbroadSearchAuditEntry) {
  return Boolean(entry.id && entry.sessionId && entry.updatedAt);
}

function compareByUpdatedAt<T extends { updatedAt: string }>(left: T, right: T) {
  return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
}

function normalizeAvoidRule(
  input: Partial<StudyAbroadSearchAvoidRule>
): StudyAbroadSearchAvoidRule {
  const link = normalizeLink(input.link);
  const domain = normalizeText(input.domain).toLowerCase() || extractDomain(link);

  return {
    id: normalizeText(input.id) || randomUUID(),
    createdAt: normalizeText(input.createdAt) || new Date().toISOString(),
    updatedAt: normalizeText(input.updatedAt) || new Date().toISOString(),
    status: input.status === "inactive" ? "inactive" : "active",
    targetType:
      input.targetType === "program" ||
      input.targetType === "domain" ||
      input.targetType === "link"
        ? input.targetType
        : "link",
    source:
      input.source === "verified" || input.source === "manual"
        ? input.source
        : "candidate",
    label: normalizeText(input.label),
    reason: normalizeText(input.reason) || "人工判定不符合标准",
    programId: normalizeText(input.programId),
    link,
    domain,
    sourceSessionId: normalizeText(input.sourceSessionId),
  };
}

function isValidAvoidRule(rule: StudyAbroadSearchAvoidRule) {
  if (!rule.id || !rule.targetType) return false;
  if (rule.targetType === "program") return Boolean(rule.programId);
  if (rule.targetType === "domain") return Boolean(rule.domain);
  return Boolean(rule.link);
}

function mergeAuditResults(
  current: StudyAbroadSearchAuditResult[],
  incoming: StudyAbroadSearchAuditResult[]
) {
  const map = new Map<string, StudyAbroadSearchAuditResult>();

  [...current, ...incoming].forEach((item) => {
    if (!item.id) return;
    map.set(item.id, item);
  });

  return Array.from(map.values()).slice(0, MAX_RESULTS_PER_AUDIT);
}

export async function readStudyAbroadSearchAuditEntries() {
  return readJsonArrayFile<StudyAbroadSearchAuditEntry>({
    fileName: AUDIT_FILE,
    fallback: [],
    normalize: normalizeAuditEntry,
    isValid: isValidAuditEntry,
    compare: compareByUpdatedAt,
  });
}

export async function readStudyAbroadSearchAvoidRules() {
  return readJsonArrayFile<StudyAbroadSearchAvoidRule>({
    fileName: AVOID_RULE_FILE,
    fallback: [],
    normalize: normalizeAvoidRule,
    isValid: isValidAvoidRule,
    compare: compareByUpdatedAt,
  });
}

export async function readStudyAbroadSearchBlocklist(): Promise<StudyAbroadSearchBlocklist> {
  const rules = await readStudyAbroadSearchAvoidRules();
  const activeRules = rules.filter((rule) => rule.status === "active");

  return {
    blockedProgramIds: new Set(
      activeRules
        .filter((rule) => rule.targetType === "program" && rule.programId)
        .map((rule) => rule.programId)
    ),
    blockedLinks: new Set(
      activeRules
        .filter((rule) => rule.targetType === "link" && rule.link)
        .map((rule) => rule.link)
    ),
    blockedDomains: new Set(
      activeRules
        .filter((rule) => rule.targetType === "domain" && rule.domain)
        .map((rule) => rule.domain)
    ),
  };
}

export async function upsertStudyAbroadSearchAuditEntry(
  input: Partial<StudyAbroadSearchAuditEntry>
) {
  const nextEntry = normalizeAuditEntry({
    ...input,
    updatedAt: new Date().toISOString(),
  });
  const entries = await readStudyAbroadSearchAuditEntries();
  const existing = entries.find((item) => item.sessionId === nextEntry.sessionId);

  const mergedEntry = existing
    ? normalizeAuditEntry({
        ...existing,
        ...nextEntry,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: new Date().toISOString(),
        results: mergeAuditResults(existing.results, nextEntry.results),
      })
    : nextEntry;

  const nextEntries = existing
    ? entries.map((item) => (item.id === existing.id ? mergedEntry : item))
    : [mergedEntry, ...entries].slice(0, MAX_AUDIT_ENTRIES);

  await writeJsonArrayFile(nextEntries, {
    fileName: AUDIT_FILE,
    normalize: normalizeAuditEntry,
    isValid: isValidAuditEntry,
    compare: compareByUpdatedAt,
  });

  return mergedEntry;
}

export async function createStudyAbroadSearchAvoidRule(input: {
  targetType: "program" | "link" | "domain";
  source?: "verified" | "candidate" | "manual";
  label?: string;
  reason?: string;
  programId?: string;
  link?: string;
  domain?: string;
  sourceSessionId?: string;
}) {
  const nextRule = normalizeAvoidRule(input);
  const rules = await readStudyAbroadSearchAvoidRules();
  const existing = rules.find((rule) => {
    if (rule.targetType !== nextRule.targetType) return false;
    if (rule.targetType === "program") return rule.programId === nextRule.programId;
    if (rule.targetType === "domain") return rule.domain === nextRule.domain;
    return rule.link === nextRule.link;
  });

  if (existing) {
    if (existing.status === "active") {
      return {
        ok: true,
        created: false,
        rule: existing,
        message: "这条结果已经在规避名单里。",
      };
    }

    const revivedRule = normalizeAvoidRule({
      ...existing,
      ...nextRule,
      id: existing.id,
      createdAt: existing.createdAt,
      status: "active",
      updatedAt: new Date().toISOString(),
    });
    const nextRules = rules.map((rule) => (rule.id === existing.id ? revivedRule : rule));

    await writeJsonArrayFile(nextRules, {
      fileName: AVOID_RULE_FILE,
      normalize: normalizeAvoidRule,
      isValid: isValidAvoidRule,
      compare: compareByUpdatedAt,
    });

    return {
      ok: true,
      created: false,
      rule: revivedRule,
      message: "这条结果已重新加入规避名单。",
    };
  }

  const nextRules = [nextRule, ...rules];

  await writeJsonArrayFile(nextRules, {
    fileName: AVOID_RULE_FILE,
    normalize: normalizeAvoidRule,
    isValid: isValidAvoidRule,
    compare: compareByUpdatedAt,
  });

  return {
    ok: true,
    created: true,
    rule: nextRule,
    message: "这条结果已加入规避名单，后续搜索会自动避开。",
  };
}

export async function updateStudyAbroadSearchAvoidRuleStatus(input: {
  id: string;
  status: "active" | "inactive";
}) {
  const id = normalizeText(input.id);
  const status = input.status === "inactive" ? "inactive" : "active";

  if (!id) {
    return {
      ok: false,
      updated: false,
      rule: null,
      message: "缺少规避规则 ID。",
    };
  }

  const rules = await readStudyAbroadSearchAvoidRules();
  const current = rules.find((rule) => rule.id === id);

  if (!current) {
    return {
      ok: false,
      updated: false,
      rule: null,
      message: "没有找到对应的规避规则。",
    };
  }

  if (current.status === status) {
    return {
      ok: true,
      updated: false,
      rule: current,
      message: status === "active" ? "这条规则已经启用。" : "这条规则已经停用。",
    };
  }

  const nextRule = normalizeAvoidRule({
    ...current,
    status,
    updatedAt: new Date().toISOString(),
  });
  const nextRules = rules.map((rule) => (rule.id === id ? nextRule : rule));

  await writeJsonArrayFile(nextRules, {
    fileName: AVOID_RULE_FILE,
    normalize: normalizeAvoidRule,
    isValid: isValidAvoidRule,
    compare: compareByUpdatedAt,
  });

  return {
    ok: true,
    updated: true,
    rule: nextRule,
    message: status === "active" ? "这条规则已恢复启用。" : "这条规则已停用，后续结果可再次出现。",
  };
}

export function isBlockedStudyAbroadFinderProgram(
  program: Pick<StudyAbroadFinderProgram, "id" | "overviewUrl" | "admissionsUrl" | "websiteDomain">,
  blocklist: StudyAbroadSearchBlocklist
) {
  if (blocklist.blockedProgramIds.has(program.id)) {
    return true;
  }

  const overviewLink = normalizeLink(program.overviewUrl);
  const admissionsLink = normalizeLink(program.admissionsUrl);
  const domain = normalizeText(program.websiteDomain).toLowerCase() || extractDomain(overviewLink);

  if (
    (overviewLink && blocklist.blockedLinks.has(overviewLink)) ||
    (admissionsLink && blocklist.blockedLinks.has(admissionsLink))
  ) {
    return true;
  }

  if (domain && blocklist.blockedDomains.has(domain)) {
    return true;
  }

  return false;
}

export function isBlockedStudyAbroadCandidate(
  candidate: Pick<{ link?: string; displayLink?: string }, "link" | "displayLink">,
  blocklist: StudyAbroadSearchBlocklist
) {
  const link = normalizeLink(candidate.link);
  const domain = extractDomain(candidate.link) || extractDomain(candidate.displayLink);

  if (link && blocklist.blockedLinks.has(link)) {
    return true;
  }

  if (domain && blocklist.blockedDomains.has(domain)) {
    return true;
  }

  return false;
}

export function normalizeStudyAbroadGovernanceLink(value?: string) {
  return normalizeLink(value);
}
