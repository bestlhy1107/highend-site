import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, Lead, eq } from "astro:db";

export type LeadStatus = "new" | "contacted" | "done" | "invalid";
export type AppointmentType = "trial" | "consultation";

export type LeadRecord = {
  id: string;
  name: string;
  contact: string;
  need: string;
  source: string;

  appointmentType: AppointmentType;
  examType: string;
  preferredTime: string;

  status: LeadStatus;
  adminNote: string;
  createdAt: string;
  updatedAt: string;
};

const JSON_FILE = join(process.cwd(), "data", "leads.json");
const LEGACY_NDJSON_FILE = join(process.cwd(), "data", "leads.ndjson");

function normalizeLead(input: Partial<LeadRecord>): LeadRecord {
  const now = new Date().toISOString();

  return {
    id: String(input.id ?? crypto.randomUUID()),
    name: String(input.name ?? "").trim(),
    contact: String(input.contact ?? "").trim(),
    need: String(input.need ?? "").trim(),
    source: String(input.source ?? "homepage").trim() || "homepage",

    appointmentType:
      input.appointmentType === "trial" ? "trial" : "consultation",
    examType: String(input.examType ?? "").trim(),
    preferredTime: String(input.preferredTime ?? "").trim(),

    status:
      input.status === "contacted" ||
      input.status === "done" ||
      input.status === "invalid"
        ? input.status
        : "new",
    adminNote: String(input.adminNote ?? "").trim(),
    createdAt: String(input.createdAt ?? now),
    updatedAt: String(input.updatedAt ?? input.createdAt ?? now),
  };
}

async function readLegacyJson(): Promise<LeadRecord[]> {
  try {
    const raw = await readFile(JSON_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.map((item) =>
      normalizeLead({
        ...item,
        appointmentType: item.appointmentType ?? "consultation",
        examType: item.examType ?? "",
        preferredTime: item.preferredTime ?? "",
      })
    );
  } catch {
    return [];
  }
}

async function readLegacyNdjson(): Promise<LeadRecord[]> {
  try {
    const raw = await readFile(LEGACY_NDJSON_FILE, "utf8");

    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .map((item) =>
        normalizeLead({
          ...item,
          appointmentType: "consultation",
          examType: "",
          preferredTime: "",
          status: "new",
          adminNote: "",
          updatedAt: item.createdAt,
        })
      );
  } catch {
    return [];
  }
}

async function migrateLegacyLeadsIfNeeded() {
  const existing = await db.select().from(Lead);

  if (existing.length > 0) return;

  const legacyJson = await readLegacyJson();
  const legacyNdjson = await readLegacyNdjson();
  const legacy = legacyJson.length ? legacyJson : legacyNdjson;

  if (!legacy.length) return;

  await db.insert(Lead).values(
    legacy.map((item) => ({
      id: item.id,
      name: item.name,
      contact: item.contact,
      need: item.need,
      source: item.source,

      appointmentType: item.appointmentType,
      examType: item.examType,
      preferredTime: item.preferredTime || null,

      status: item.status,
      adminNote: item.adminNote || null,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    }))
  );
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }

  return new Date().toISOString();
}


function mapDbLead(row: {
  id: string;
  name: string;
  contact: string;
  need: string;
  source: string;
  appointmentType: string;
  examType: string;
  preferredTime: string | null;
  status: string;
  adminNote: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}): LeadRecord {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact,
    need: row.need,
    source: row.source,

    appointmentType: row.appointmentType === "trial" ? "trial" : "consultation",
    examType: row.examType ?? "",
    preferredTime: row.preferredTime ?? "",

    status:
      row.status === "contacted" ||
      row.status === "done" ||
      row.status === "invalid"
        ? row.status
        : "new",

    adminNote: row.adminNote ?? "",
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}



export async function readLeads(): Promise<LeadRecord[]> {
  await migrateLegacyLeadsIfNeeded();

  const rows = await db.select().from(Lead);

  return rows
    .map(mapDbLead)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function createLead(input: {
  name: string;
  contact: string;
  need: string;
  source?: string;
  appointmentType: AppointmentType;
  examType: string;
  preferredTime?: string;
}) {
  await migrateLegacyLeadsIfNeeded();

  const now = new Date();

  const lead = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    contact: input.contact.trim(),
    need: input.need.trim(),
    source: String(input.source ?? "homepage").trim() || "homepage",

    appointmentType: input.appointmentType,
    examType: input.examType.trim(),
    preferredTime: String(input.preferredTime ?? "").trim(),

    status: "new" as const,
    adminNote: "",
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(Lead).values({
    id: lead.id,
    name: lead.name,
    contact: lead.contact,
    need: lead.need,
    source: lead.source,

    appointmentType: lead.appointmentType,
    examType: lead.examType,
    preferredTime: lead.preferredTime || null,

    status: lead.status,
    adminNote: null,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  });

  return {
    ...lead,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

export async function updateLeadById(input: {
  id: string;
  status: LeadStatus;
  adminNote?: string;
}) {
  await db
    .update(Lead)
    .set({
      status: input.status,
      adminNote: String(input.adminNote ?? "").trim(),
      updatedAt: new Date(),
    })
    .where(eq(Lead.id, input.id));

  const rows = await db.select().from(Lead).where(eq(Lead.id, input.id));
  const row = rows[0];

  if (!row) {
    throw new Error("Lead not found");
  }

  return mapDbLead(row);
}

export async function deleteLeadById(id: string) {
  await db.delete(Lead).where(eq(Lead.id, id));
}

export async function countLeads() {
  const rows = await db.select().from(Lead);
  return rows.length;
}