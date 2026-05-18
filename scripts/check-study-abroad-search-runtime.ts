import { runStudyAbroadSearchRuntimeCheck } from "../src/lib/study-abroad-search";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const result = await runStudyAbroadSearchRuntimeCheck({
    probe: hasFlag("probe"),
    freeText: readArg("free-text"),
    country: readArg("country"),
    degree: readArg("degree"),
    major: readArg("major"),
    specialization: readArg("specialization"),
  });

  console.log(
    JSON.stringify(
      {
        externalSearchEnabled: result.status.externalSearchEnabled,
        provider: result.status.provider,
        model: result.status.model,
        apiKeyPresent: result.status.apiKeyPresent,
        timeoutMs: result.status.timeoutMs,
        maxCandidateResults: result.status.maxCandidateResults,
        maxReviewQueueCandidates: result.status.maxReviewQueueCandidates,
        probe: result.probe,
      },
      null,
      2
    )
  );

  if (hasFlag("probe") && !result.probe.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[study-abroad-runtime-check] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
