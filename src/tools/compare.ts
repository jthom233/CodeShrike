import { getDatabase } from "../db/connection.js";
import {
  getSuite,
  getRunsForSuite,
  getRun,
  getResults,
  getSteps,
} from "../db/queries.js";

interface ClassifiedStep {
  step_id: string;
  step_name: string;
  layer: string;
  status_a: string | null;
  status_b: string | null;
  screenshot_a: string | null;
  screenshot_b: string | null;
}

export function handleCompare(
  args: {
    suite_id: string;
    run_id_a?: string;
    run_id_b?: string;
  },
  projectPath: string
) {
  const db = getDatabase(projectPath);

  // 1. Validate suite exists
  const suite = getSuite(db, args.suite_id);
  if (!suite) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `Suite '${args.suite_id}' not found` }),
        },
      ],
    };
  }

  // 2. Resolve run_id_a and run_id_b
  let runIdA: string;
  let runIdB: string;

  if (args.run_id_a && args.run_id_b) {
    runIdA = args.run_id_a;
    runIdB = args.run_id_b;
  } else if (!args.run_id_a && !args.run_id_b) {
    const recentRuns = getRunsForSuite(db, args.suite_id, 2);
    if (recentRuns.length < 2) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: `Suite '${args.suite_id}' has fewer than 2 runs; cannot auto-compare`,
            }),
          },
        ],
      };
    }
    // runs[0] = newest (run_b), runs[1] = older (run_a)
    runIdA = recentRuns[1].id;
    runIdB = recentRuns[0].id;
  } else {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            error:
              "Provide both run_id_a and run_id_b, or neither (to auto-select the last two runs)",
          }),
        },
      ],
    };
  }

  // Fetch run records
  const runA = getRun(db, runIdA);
  if (!runA) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `Run '${runIdA}' not found` }),
        },
      ],
    };
  }
  const runB = getRun(db, runIdB);
  if (!runB) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: `Run '${runIdB}' not found` }),
        },
      ],
    };
  }

  // 3. Get results for both runs
  const resultsA = getResults(db, runIdA);
  const resultsB = getResults(db, runIdB);

  // 4. Get steps for the suite
  const steps = getSteps(db, args.suite_id);
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  // Build result maps keyed by step_id
  const resultMapA = new Map(resultsA.map((r) => [r.step_id, r]));
  const resultMapB = new Map(resultsB.map((r) => [r.step_id, r]));

  // 5. Collect all step IDs across both runs and the suite definition
  const allStepIds = new Set<string>([
    ...steps.map((s) => s.id),
    ...resultsA.map((r) => r.step_id),
    ...resultsB.map((r) => r.step_id),
  ]);

  // 6. Classify each step
  const regressions: ClassifiedStep[] = [];
  const improvements: ClassifiedStep[] = [];
  const persistentFailures: ClassifiedStep[] = [];
  const unchangedPasses: ClassifiedStep[] = [];
  const newSteps: ClassifiedStep[] = [];
  const removedSteps: ClassifiedStep[] = [];
  const otherChanges: ClassifiedStep[] = [];

  for (const stepId of allStepIds) {
    const step = stepMap.get(stepId);
    const resA = resultMapA.get(stepId);
    const resB = resultMapB.get(stepId);

    const entry: ClassifiedStep = {
      step_id: stepId,
      step_name: step?.name ?? stepId,
      layer: step?.layer ?? "unknown",
      status_a: resA?.status ?? null,
      status_b: resB?.status ?? null,
      screenshot_a: resA?.screenshot ?? null,
      screenshot_b: resB?.screenshot ?? null,
    };

    if (!resA && resB) {
      newSteps.push(entry);
    } else if (resA && !resB) {
      removedSteps.push(entry);
    } else if (resA && resB) {
      if (resA.status === "pass" && resB.status === "fail") {
        regressions.push(entry);
      } else if (resA.status === "fail" && resB.status === "pass") {
        improvements.push(entry);
      } else if (resA.status === "fail" && resB.status === "fail") {
        persistentFailures.push(entry);
      } else if (resA.status === "pass" && resB.status === "pass") {
        unchangedPasses.push(entry);
      } else {
        otherChanges.push(entry);
      }
    }
    // If neither run has a result for this step_id (only in stepMap), skip silently
  }

  const totalSteps = allStepIds.size;

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          suite_id: args.suite_id,
          run_a: {
            id: runA.id,
            label: runA.label,
            started_at: runA.started_at,
          },
          run_b: {
            id: runB.id,
            label: runB.label,
            started_at: runB.started_at,
          },
          regressions,
          improvements,
          persistent_failures: persistentFailures,
          unchanged_passes: unchangedPasses,
          new_steps: newSteps,
          removed_steps: removedSteps,
          other_changes: otherChanges,
          summary: {
            total_steps: totalSteps,
            regressions: regressions.length,
            improvements: improvements.length,
            persistent_failures: persistentFailures.length,
            unchanged_passes: unchangedPasses.length,
          },
        }),
      },
    ],
  };
}
