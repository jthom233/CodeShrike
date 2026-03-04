import { nanoid } from "nanoid";
import { getDatabase } from "../db/connection.js";
import {
  getSuite,
  getSteps,
  createRun,
  getActiveRun,
  closeRun,
  getResults,
  recordResult,
  getTimedOutRuns,
} from "../db/queries.js";
import { storeScreenshot } from "../storage/screenshots.js";

export function handleRecord(
  args: {
    suite_id: string;
    run_label?: string;
    results: Array<{
      step_id: string;
      status: "pass" | "fail" | "skip" | "blocked";
      actual?: string;
      screenshot_path?: string;
      notes?: string;
    }>;
    _complete?: boolean;
  },
  projectPath: string
): { content: Array<{ type: "text"; text: string }> } {
  const db = getDatabase(projectPath);

  // Validate suite exists
  const suite = getSuite(db, args.suite_id);
  if (!suite) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ error: `Suite not found: ${args.suite_id}` }),
        },
      ],
    };
  }

  // Get steps (needed for ordinal lookup and step validation)
  const steps = getSteps(db, args.suite_id);
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  // Find or create active run
  let run = getActiveRun(db, args.suite_id);
  if (!run) {
    const runId = `run_${nanoid(12)}`;
    createRun(db, {
      id: runId,
      suiteId: args.suite_id,
      suiteVersion: suite.version,
      label: args.run_label,
    });
    // Re-fetch to get the full row (started_at etc.)
    run = getActiveRun(db, args.suite_id)!;
  }

  const runId = run.id;

  // Record each result
  for (const result of args.results) {
    const step = stepMap.get(result.step_id);
    if (!step) {
      // Skip unknown step IDs gracefully — don't abort the whole call
      console.error(
        `[codeshrike] shrike_record: unknown step_id "${result.step_id}" in suite "${args.suite_id}", skipping`
      );
      continue;
    }

    let screenshotRelPath: string | null = null;
    if (result.screenshot_path) {
      screenshotRelPath = storeScreenshot(
        projectPath,
        args.suite_id,
        runId,
        step.ordinal,
        step.id,
        result.screenshot_path
      );
    }

    recordResult(db, {
      id: nanoid(12),
      runId,
      stepId: result.step_id,
      status: result.status,
      actual: result.actual,
      notes: result.notes,
      screenshot: screenshotRelPath ?? undefined,
    });
  }

  // Compute progress
  const allResults = getResults(db, runId);
  const recordedStepIds = new Set(allResults.map((r) => r.step_id));

  const passed = allResults.filter((r) => r.status === "pass").length;
  const failed = allResults.filter((r) => r.status === "fail").length;
  const skipped = allResults.filter((r) => r.status === "skip").length;
  const blocked = allResults.filter((r) => r.status === "blocked").length;
  const untested = steps.length - allResults.length;

  const runProgress = {
    total: steps.length,
    passed,
    failed,
    skipped,
    blocked,
    untested,
  };

  // Remaining steps: steps without any recorded result
  const remainingSteps = steps
    .filter((s) => !recordedStepIds.has(s.id))
    .map((s) => ({ step_id: s.id, name: s.name, layer: s.layer }));

  // Close run if requested
  if (args._complete) {
    closeRun(db, runId, "completed", {
      total: steps.length,
      passed,
      failed,
      skipped,
      blocked,
      untested,
    });
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          run_id: runId,
          recorded: args.results.length,
          run_progress: runProgress,
          remaining_steps: remainingSteps,
        }),
      },
    ],
  };
}

export function startAutoCloseTimer(
  projectPath: string,
  intervalMs = 60_000,
  timeoutMinutes = 10
): NodeJS.Timeout {
  return setInterval(() => {
    try {
      const db = getDatabase(projectPath);
      const timedOut = getTimedOutRuns(db, timeoutMinutes);
      for (const run of timedOut) {
        const results = getResults(db, run.id);
        const steps = getSteps(db, run.suite_id);
        const passed = results.filter((r) => r.status === "pass").length;
        const failed = results.filter((r) => r.status === "fail").length;
        const skipped = results.filter((r) => r.status === "skip").length;
        const blocked = results.filter((r) => r.status === "blocked").length;
        const untested = steps.length - results.length;
        closeRun(db, run.id, "timed_out", {
          total: steps.length,
          passed,
          failed,
          skipped,
          blocked,
          untested,
        });
        console.error(`[codeshrike] Auto-closed timed out run ${run.id}`);
      }
    } catch (err) {
      console.error("[codeshrike] Auto-close timer error:", err);
    }
  }, intervalMs);
}
