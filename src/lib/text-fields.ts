export type FaqItem = {
  q: string;
  a: string;
};

export function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function splitLines(input?: string) {
  return String(input ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitCsv(input?: string) {
  return String(input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseFaqLines(input?: string): FaqItem[] {
  return splitLines(input)
    .map((line) => {
      const [question, ...answerParts] = line.split("|");
      return {
        q: String(question ?? "").trim(),
        a: answerParts.join("|").trim(),
      };
    })
    .filter((item) => item.q && item.a);
}

export function normalizeStringArray(input: unknown) {
  return Array.isArray(input) ? input.map((item) => String(item)).filter(Boolean) : [];
}

export function normalizeFaqArray(input: unknown): FaqItem[] {
  return Array.isArray(input)
    ? input
        .map((item) => ({
          q: String(item?.q ?? "").trim(),
          a: String(item?.a ?? "").trim(),
        }))
        .filter((item) => item.q && item.a)
    : [];
}
