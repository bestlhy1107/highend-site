export function normalizeImageUrl(input?: string | null) {
  if (!input) return "";

  if (
    input.startsWith("http://") ||
    input.startsWith("https://") ||
    input.startsWith("/api/uploads/")
  ) {
    return input;
  }

  if (input.startsWith("/uploads/")) {
    return `/api${input}`;
  }

  return input;
}