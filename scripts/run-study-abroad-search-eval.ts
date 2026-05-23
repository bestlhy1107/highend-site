import {
  evaluateStudyAbroadSearchCases,
  type StudyAbroadSearchEvalCaseReport,
} from "../src/lib/study-abroad-search-eval";

function readArg(name: string) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((item) => item.startsWith(prefix));
  return hit ? hit.slice(prefix.length).trim() : "";
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function printCase(item: StudyAbroadSearchEvalCaseReport) {
  const status = item.passed ? "PASS" : "FAIL";
  console.log(
    `${status} ${item.id} | verified=${item.metrics.verifiedCount} | universities=${item.metrics.universityCount} | candidates=${item.metrics.candidateCount} | blocked=${item.metrics.blockedCount}`
  );

  if (item.reasons.length) {
    item.reasons.forEach((reason) => {
      console.log(`  - ${reason}`);
    });
  }
}

async function main() {
  const caseId = readArg("case");
  const persistReport = !hasFlag("no-write-report");
  const report = await evaluateStudyAbroadSearchCases({
    caseId,
    persistReport,
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: report.generatedAt,
        totalCases: report.totalCases,
        passedCases: report.passedCases,
        failedCases: report.failedCases,
        passRate: report.passRate,
        zeroResultCases: report.zeroResultCases,
        lowResultCases: report.lowResultCases,
        candidateHeavyCases: report.candidateHeavyCases,
        candidateHeavyRate: report.candidateHeavyRate,
        blockedCases: report.blockedCases,
        totalBlockedCount: report.totalBlockedCount,
        averageBlockedCount: report.averageBlockedCount,
        blockedResultRate: report.blockedResultRate,
        postAvoidQualityRate: report.postAvoidQualityRate,
        averageVerifiedCount: report.averageVerifiedCount,
        averageUniversityCount: report.averageUniversityCount,
        averageCandidateCount: report.averageCandidateCount,
        countrySegments: report.byCountry.length,
        majorSegments: report.byMajor.length,
        persisted: persistReport && !caseId,
      },
      null,
      2
    )
  );

  console.log("");
  report.cases.forEach(printCase);
}

main().catch((error) => {
  console.error("[study-abroad-eval] failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
