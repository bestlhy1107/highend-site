import { rebuildStudyAbroadFinderIndexes } from "../src/lib/study-abroad-catalog-store";

const startedAt = performance.now();
const result = await rebuildStudyAbroadFinderIndexes();
const elapsedMs = Math.round(performance.now() - startedAt);

console.log(
  JSON.stringify(
    {
      ok: true,
      ...result,
      elapsedMs,
    },
    null,
    2
  )
);
