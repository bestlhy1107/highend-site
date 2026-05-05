import {
  executeStudyAbroadAdmissionsCampaignCadence,
  executeStudyAbroadAdmissionsCoverageRoadmap,
  executeStudyAbroadAdmissionsCoverageSprint,
  readStudyAbroadAdmissionsCampaignCadence,
  readStudyAbroadAdmissionsCoverageSprintPlan,
  readStudyAbroadAdmissionsCoverageSprintRoadmap,
} from "../src/lib/study-abroad-admissions-sync";

type Mode = "cadence" | "roadmap" | "sprint";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function toPositiveInt(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const mode = (readArg("mode") || "cadence") as Mode;
  const degree = readArg("degree") || "硕士";
  const rounds = toPositiveInt(readArg("rounds"), 3);
  const maxCountries = toPositiveInt(readArg("max-countries"), 2);
  const maxFocusPerCountry = toPositiveInt(readArg("max-focus"), 2);
  const maxRecommendations = toPositiveInt(readArg("max-recommendations"), 3);
  const dryRun = hasFlag("dry-run");

  if (mode !== "cadence" && mode !== "roadmap" && mode !== "sprint") {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  if (mode === "cadence") {
    const cadence = await readStudyAbroadAdmissionsCampaignCadence({ degree });

    if (dryRun) {
      printJson({
        mode,
        dryRun,
        cadence,
      });
      return;
    }

    const result = await executeStudyAbroadAdmissionsCampaignCadence({ degree });
    printJson({
      mode,
      message: result.message,
      cadence: result.cadence,
      syncedCount: result.syncedCount,
      okCount: result.okCount,
      partialCount: result.partialCount,
      unavailableCount: result.unavailableCount,
      delta: result.delta,
    });
    return;
  }

  if (mode === "roadmap") {
    if (dryRun) {
      const roadmap = await readStudyAbroadAdmissionsCoverageSprintRoadmap({
        degree,
        rounds,
        maxCountries,
        maxFocusPerCountry,
        maxRecommendations,
      });
      printJson({
        mode,
        dryRun,
        roadmap,
      });
      return;
    }

    const result = await executeStudyAbroadAdmissionsCoverageRoadmap({
      degree,
      rounds,
      maxCountries,
      maxFocusPerCountry,
      maxRecommendations,
    });
    printJson({
      mode,
      message: result.message,
      syncedCount: result.syncedCount,
      okCount: result.okCount,
      partialCount: result.partialCount,
      unavailableCount: result.unavailableCount,
      delta: result.delta,
      roadmapRuns: result.roadmapRuns,
    });
    return;
  }

  if (dryRun) {
    const plan = await readStudyAbroadAdmissionsCoverageSprintPlan({
      degree,
      maxCountries,
      maxFocusPerCountry,
      maxRecommendations,
    });
    printJson({
      mode,
      dryRun,
      plan,
    });
    return;
  }

  const result = await executeStudyAbroadAdmissionsCoverageSprint({
    degree,
    maxCountries,
    maxFocusPerCountry,
    maxRecommendations,
  });
  printJson({
    mode,
    message: result.message,
    syncedCount: result.syncedCount,
    okCount: result.okCount,
    partialCount: result.partialCount,
    unavailableCount: result.unavailableCount,
    delta: result.delta,
    plan: result.plan,
  });
}

main().catch((error) => {
  console.error("[study-abroad-campaign] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
