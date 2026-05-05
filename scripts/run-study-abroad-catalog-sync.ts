import {
  executeStudyAbroadCatalogSync,
  resolveStudyAbroadCatalogSyncSelection,
  readStudyAbroadCatalogSyncState,
} from "../src/lib/study-abroad-catalog-sync";

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
  const dryRun = hasFlag("dry-run");
  const includeGlobal = !hasFlag("skip-global");
  const includeUs = hasFlag("include-us") ? true : !hasFlag("skip-us");
  const includeUk = !hasFlag("skip-uk");
  const usMaxPages = toPositiveInt(readArg("us-max-pages"), 10);
  const usPerPage = toPositiveInt(readArg("us-per-page"), 100);
  const selection = resolveStudyAbroadCatalogSyncSelection({
    includeGlobal,
    includeUs,
    includeUk,
    usMaxPages,
    usPerPage,
  });

  if (dryRun) {
    const state = await readStudyAbroadCatalogSyncState();
    printJson({
      dryRun: true,
      selection: {
        includeGlobal: selection.includeGlobal,
        includeUs: selection.includeUs,
        includeUk: selection.includeUk,
        skippedUsForDemoKey: selection.skippedUsForDemoKey,
        usMaxPages,
        usPerPage,
        scorecardMode: selection.scorecardMode,
      },
      lastRun: state.runs[0] ?? null,
    });
    return;
  }

  const result = await executeStudyAbroadCatalogSync({
    includeGlobal,
    includeUs,
    includeUk,
    usMaxPages,
    usPerPage,
    mode: "auto",
    trigger: "script",
  });

  printJson(result);
}

main().catch((error) => {
  console.error("[study-abroad-catalog-sync] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
