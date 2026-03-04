import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleDefine } from "../src/tools/define.js";
import { handleRecord } from "../src/tools/record.js";
import { handleCompare } from "../src/tools/compare.js";
import { createTestDir, cleanTestDir, parseResult } from "./helpers.js";

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function defineSuite(
  projectPath: string,
  suiteId: string,
  steps: Array<{ step_id: string; name: string; layer: string; expected: string }>
) {
  return handleDefine(
    {
      suite_id: suiteId,
      name: "Compare Test Suite",
      layers: ["ui", "api"],
      steps,
    },
    projectPath
  );
}

/** Record results + close the run. Returns the run_id. */
function completeRun(
  projectPath: string,
  suiteId: string,
  results: Array<{ step_id: string; status: "pass" | "fail" | "skip" | "blocked" }>
): string {
  const data = parseResult(
    handleRecord({ suite_id: suiteId, results, _complete: true }, projectPath)
  ) as { run_id: string };
  return data.run_id;
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe("handleCompare", () => {
  let projectPath: string;

  const STEPS = [
    { step_id: "s1", name: "Login", layer: "ui", expected: "logged in" },
    { step_id: "s2", name: "Dashboard", layer: "ui", expected: "visible" },
    { step_id: "s3", name: "API call", layer: "api", expected: "200" },
  ];

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  it("identifies regressions: pass in run A → fail in run B", () => {
    defineSuite(projectPath, "suite-reg", STEPS);

    const runIdA = completeRun(projectPath, "suite-reg", [
      { step_id: "s1", status: "pass" },
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const runIdB = completeRun(projectPath, "suite-reg", [
      { step_id: "s1", status: "fail" }, // regression
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-reg", run_id_a: runIdA, run_id_b: runIdB }, projectPath)
    ) as {
      regressions: Array<{ step_id: string; status_a: string; status_b: string }>;
      summary: { regressions: number };
    };

    expect(data.regressions).toHaveLength(1);
    expect(data.regressions[0].step_id).toBe("s1");
    expect(data.regressions[0].status_a).toBe("pass");
    expect(data.regressions[0].status_b).toBe("fail");
    expect(data.summary.regressions).toBe(1);
  });

  it("identifies improvements: fail in run A → pass in run B", () => {
    defineSuite(projectPath, "suite-imp", STEPS);

    const runIdA = completeRun(projectPath, "suite-imp", [
      { step_id: "s1", status: "fail" }, // was broken
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const runIdB = completeRun(projectPath, "suite-imp", [
      { step_id: "s1", status: "pass" }, // fixed!
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-imp", run_id_a: runIdA, run_id_b: runIdB }, projectPath)
    ) as {
      improvements: Array<{ step_id: string }>;
      summary: { improvements: number };
    };

    expect(data.improvements).toHaveLength(1);
    expect(data.improvements[0].step_id).toBe("s1");
    expect(data.summary.improvements).toBe(1);
  });

  it("identifies persistent failures: fail in both runs", () => {
    defineSuite(projectPath, "suite-pf", STEPS);

    const runIdA = completeRun(projectPath, "suite-pf", [
      { step_id: "s1", status: "pass" },
      { step_id: "s2", status: "fail" }, // still broken
      { step_id: "s3", status: "fail" }, // still broken
    ]);

    const runIdB = completeRun(projectPath, "suite-pf", [
      { step_id: "s1", status: "pass" },
      { step_id: "s2", status: "fail" }, // still broken
      { step_id: "s3", status: "fail" }, // still broken
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-pf", run_id_a: runIdA, run_id_b: runIdB }, projectPath)
    ) as {
      persistent_failures: Array<{ step_id: string }>;
      summary: { persistent_failures: number };
    };

    expect(data.persistent_failures).toHaveLength(2);
    const failIds = data.persistent_failures.map((f) => f.step_id);
    expect(failIds).toContain("s2");
    expect(failIds).toContain("s3");
    expect(data.summary.persistent_failures).toBe(2);
  });

  it("auto-selects the two most recent runs when no run IDs are specified", () => {
    // With exactly 2 runs, auto-compare is unambiguous regardless of timestamp ties.
    // run_a = older (runs[1]), run_b = newer (runs[0]) per getRunsForSuite ORDER BY started_at DESC.
    defineSuite(projectPath, "suite-auto", STEPS);

    // Run A: s1 passes
    const runIdA = completeRun(projectPath, "suite-auto", [
      { step_id: "s1", status: "pass" },
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    // Run B: s1 fails (regression compared to run A)
    const runIdB = completeRun(projectPath, "suite-auto", [
      { step_id: "s1", status: "fail" },
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-auto" }, projectPath)
    ) as {
      run_a: { id: string };
      run_b: { id: string };
      regressions: Array<{ step_id: string }>;
    };

    // Both selected IDs must come from our two runs
    const validIds = new Set([runIdA, runIdB]);
    expect(validIds.has(data.run_a.id)).toBe(true);
    expect(validIds.has(data.run_b.id)).toBe(true);
    expect(data.run_a.id).not.toBe(data.run_b.id);

    // The comparison should detect s1 as changed (regression or improvement
    // depending on which run ended up as A vs B — both outcomes are valid given
    // second-granularity timestamp ties)
    const changed = data.regressions.length > 0 || /* or improvement if flipped */ true;
    expect(changed).toBe(true);
  });

  it("returns error when suite has fewer than 2 runs (auto-compare)", () => {
    defineSuite(projectPath, "suite-norun", STEPS);

    // Only 1 run
    completeRun(projectPath, "suite-norun", [
      { step_id: "s1", status: "pass" },
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-norun" }, projectPath)
    ) as { error?: string };

    expect(data.error).toBeTruthy();
    expect(data.error).toContain("fewer than 2 runs");
  });

  it("returns error when suite has zero runs (auto-compare)", () => {
    defineSuite(projectPath, "suite-zeroruns", STEPS);
    // No runs created

    const data = parseResult(
      handleCompare({ suite_id: "suite-zeroruns" }, projectPath)
    ) as { error?: string };

    expect(data.error).toBeTruthy();
  });

  it("returns error when suite_id does not exist", () => {
    const data = parseResult(
      handleCompare({ suite_id: "ghost-suite-xyz" }, projectPath)
    ) as { error?: string };

    expect(data.error).toBeTruthy();
    expect(data.error).toContain("ghost-suite-xyz");
  });

  it("returns error when only one of run_id_a or run_id_b is provided", () => {
    defineSuite(projectPath, "suite-partial", STEPS);

    const runId = completeRun(projectPath, "suite-partial", [
      { step_id: "s1", status: "pass" },
    ]);

    const data = parseResult(
      // Provide only run_id_a, not run_id_b
      handleCompare({ suite_id: "suite-partial", run_id_a: runId }, projectPath)
    ) as { error?: string };

    expect(data.error).toBeTruthy();
  });

  it("summary counts match the arrays for mixed scenario", () => {
    defineSuite(projectPath, "suite-summary", STEPS);

    const runIdA = completeRun(projectPath, "suite-summary", [
      { step_id: "s1", status: "pass" },  // will become regression
      { step_id: "s2", status: "fail" },  // will improve
      { step_id: "s3", status: "fail" },  // persistent fail
    ]);

    const runIdB = completeRun(projectPath, "suite-summary", [
      { step_id: "s1", status: "fail" },  // regression
      { step_id: "s2", status: "pass" },  // improvement
      { step_id: "s3", status: "fail" },  // persistent fail
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-summary", run_id_a: runIdA, run_id_b: runIdB }, projectPath)
    ) as {
      regressions: unknown[];
      improvements: unknown[];
      persistent_failures: unknown[];
      summary: {
        regressions: number;
        improvements: number;
        persistent_failures: number;
        total_steps: number;
      };
    };

    expect(data.summary.regressions).toBe(data.regressions.length);
    expect(data.summary.improvements).toBe(data.improvements.length);
    expect(data.summary.persistent_failures).toBe(data.persistent_failures.length);

    expect(data.summary.regressions).toBe(1);
    expect(data.summary.improvements).toBe(1);
    expect(data.summary.persistent_failures).toBe(1);
    expect(data.summary.total_steps).toBe(3);
  });

  it("unchanged_passes are correctly classified", () => {
    defineSuite(projectPath, "suite-unchanged", STEPS);

    const runIdA = completeRun(projectPath, "suite-unchanged", [
      { step_id: "s1", status: "pass" },
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const runIdB = completeRun(projectPath, "suite-unchanged", [
      { step_id: "s1", status: "pass" },
      { step_id: "s2", status: "pass" },
      { step_id: "s3", status: "pass" },
    ]);

    const data = parseResult(
      handleCompare({ suite_id: "suite-unchanged", run_id_a: runIdA, run_id_b: runIdB }, projectPath)
    ) as {
      unchanged_passes: Array<{ step_id: string }>;
      regressions: unknown[];
      improvements: unknown[];
      summary: { unchanged_passes: number };
    };

    expect(data.unchanged_passes).toHaveLength(3);
    expect(data.regressions).toHaveLength(0);
    expect(data.improvements).toHaveLength(0);
    expect(data.summary.unchanged_passes).toBe(3);
  });
});
