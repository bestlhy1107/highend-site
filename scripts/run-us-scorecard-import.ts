import { syncUsStudyAbroadCatalog } from "../src/lib/study-abroad-us-import";

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
}

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const maxPages = toPositiveInt(readArg("max-pages"), 50);
  const startPage = Math.max(0, Number.parseInt(readArg("start-page") || "0", 10) || 0);
  const perPage = toPositiveInt(readArg("per-page"), 100);
  const requestTimeoutMs = toPositiveInt(readArg("request-timeout-ms"), 90000);
  const pageDelayMs = toPositiveInt(readArg("page-delay-ms"), 450);
  const refreshHipoUniversities = !hasFlag("skip-hipo");

  const result = await syncUsStudyAbroadCatalog({
    startPage,
    maxPages,
    perPage,
    requestTimeoutMs,
    pageDelayMs,
    refreshHipoUniversities,
  });

  printJson(result);
}

main().catch((error) => {
  console.error("[study-abroad-us-scorecard-import] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
