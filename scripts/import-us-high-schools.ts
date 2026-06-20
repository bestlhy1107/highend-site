import { syncUsSecondarySchoolCatalogFromFile } from "../src/lib/study-abroad-us-secondary-import";

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
  const filePath = readArg("file") || process.env.NCES_CCD_SCHOOL_FILE || "";
  const maxRecords = toPositiveInt(readArg("max-records"), 0);
  const state = readArg("state");
  const dryRun = hasFlag("dry-run");

  const result = await syncUsSecondarySchoolCatalogFromFile({
    filePath,
    maxRecords,
    state,
    dryRun,
  });

  printJson(result);
}

main().catch((error) => {
  console.error("[study-abroad-us-high-schools] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
