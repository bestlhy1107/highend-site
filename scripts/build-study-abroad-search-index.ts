import { rebuildStudyAbroadFinderIndexes } from "../src/lib/study-abroad-catalog-store";
import { rebuildStudyAbroadSearchDatabase } from "../src/lib/study-abroad-search-db";

const startedAt = performance.now();
const [indexResult, searchDbResult] = await Promise.all([
  rebuildStudyAbroadFinderIndexes(),
  rebuildStudyAbroadSearchDatabase(),
]);
const elapsedMs = Math.round(performance.now() - startedAt);

console.log(
  JSON.stringify(
    {
      ok: true,
      ...indexResult,
      searchDb: searchDbResult,
      elapsedMs,
    },
    null,
    2
  )
);
