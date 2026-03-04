import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import { existsSync, readdirSync } from "fs";
import { handleDefine } from "../src/tools/define.js";
import { handleRecord } from "../src/tools/record.js";
import { handleQuery } from "../src/tools/query.js";
import { handleCompare } from "../src/tools/compare.js";
import { createTestDir, cleanTestDir, createFakePng, parseResult } from "./helpers.js";

// -------------------------------------------------------------------------
// Shared step definitions for the main lifecycle test
// -------------------------------------------------------------------------

const LIFECYCLE_STEPS_V1 = [
  { step_id: "lc-s1", name: "Verify login form renders", layer: "ui",   expected: "Form renders" },
  { step_id: "lc-s2", name: "Submit login request",      layer: "api",  expected: "HTTP 200" },
  { step_id: "lc-s3", name: "Validate auth token",       layer: "auth", expected: "Token valid" },
  { step_id: "lc-s4", name: "Check dashboard loads",     layer: "ui",   expected: "Dashboard visible" },
  { step_id: "lc-s5", name: "Verify session cookie",     layer: "auth", expected: "Cookie present" },
];

const LIFECYCLE_STEPS_V2 = [
  ...LIFECYCLE_STEPS_V1,
  { step_id: "lc-s6", name: "Check rate limiting", layer: "api", expected: "429 after limit" },
];

// -------------------------------------------------------------------------
// Full lifecycle test
// -------------------------------------------------------------------------

describe("Full lifecycle — define, record, query, compare", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  it("exercises the complete define → record → query → compare flow", () => {
    // -----------------------------------------------------------------------
    // 1. Define the suite with 5 steps across 3 layers
    // -----------------------------------------------------------------------
    const defineResult = parseResult(
      handleDefine(
        {
          suite_id: "lc-suite",
          name: "Login Lifecycle Suite",
          description: "End-to-end login flow",
          layers: ["ui", "api", "auth"],
          steps: LIFECYCLE_STEPS_V1,
        },
        projectPath
      )
    ) as { suite_id: string; version: number; step_count: number; step_ids: string[] };

    expect(defineResult.suite_id).toBe("lc-suite");
    expect(defineResult.version).toBe(1);
    expect(defineResult.step_count).toBe(5);
    expect(defineResult.step_ids).toHaveLength(5);

    // -----------------------------------------------------------------------
    // 2. Record Run 1 — partial results (3 of 5 steps)
    // -----------------------------------------------------------------------
    const screenshotSrc = path.join(projectPath, "step1-screenshot.png");
    createFakePng(screenshotSrc);

    const run1Data = parseResult(
      handleRecord(
        {
          suite_id: "lc-suite",
          run_label: "run-1-partial",
          results: [
            { step_id: "lc-s1", status: "pass", screenshot_path: screenshotSrc },
            { step_id: "lc-s2", status: "pass" },
            { step_id: "lc-s3", status: "fail", actual: "Token expired" },
          ],
          _complete: true,
        },
        projectPath
      )
    ) as {
      run_id: string;
      recorded: number;
      run_progress: {
        total: number;
        passed: number;
        failed: number;
        untested: number;
      };
      remaining_steps: Array<{ step_id: string; name: string; layer: string }>;
    };

    const run1Id = run1Data.run_id;
    expect(run1Id).toMatch(/^run_/);
    expect(run1Data.recorded).toBe(3);

    // remaining_steps: steps 4 and 5 were not recorded
    expect(run1Data.remaining_steps).toHaveLength(2);
    const remainingIds1 = run1Data.remaining_steps.map((s) => s.step_id);
    expect(remainingIds1).toContain("lc-s4");
    expect(remainingIds1).toContain("lc-s5");
    expect(remainingIds1).not.toContain("lc-s1");
    expect(remainingIds1).not.toContain("lc-s2");
    expect(remainingIds1).not.toContain("lc-s3");

    // progress: 2 passed, 1 failed, 2 untested
    expect(run1Data.run_progress.total).toBe(5);
    expect(run1Data.run_progress.passed).toBe(2);
    expect(run1Data.run_progress.failed).toBe(1);
    expect(run1Data.run_progress.untested).toBe(2);

    // -----------------------------------------------------------------------
    // 3. Query the suite — verify structure and scope coverage
    // -----------------------------------------------------------------------
    const suiteQueryData = parseResult(
      handleQuery({ suite_id: "lc-suite" }, projectPath)
    ) as {
      suite: { id: string; version: number };
      steps: Array<{ id: string }>;
      scope_coverage: { intended: string[]; actual: string[]; gaps: string[] };
      runs: Array<{ id: string; summary: Record<string, unknown> }>;
    };

    expect(suiteQueryData.suite.id).toBe("lc-suite");
    expect(suiteQueryData.steps).toHaveLength(5);

    // Scope coverage: all 3 declared layers have steps → no gaps
    expect(suiteQueryData.scope_coverage.intended).toEqual(
      expect.arrayContaining(["ui", "api", "auth"])
    );
    expect(suiteQueryData.scope_coverage.actual).toEqual(
      expect.arrayContaining(["ui", "api", "auth"])
    );
    expect(suiteQueryData.scope_coverage.gaps).toHaveLength(0);

    // Latest run summary should reflect 2 passed, 1 failed, 2 untested
    expect(suiteQueryData.runs).toHaveLength(1);
    const latestRunSummary = suiteQueryData.runs[0].summary;
    expect(latestRunSummary.passed).toBe(2);
    expect(latestRunSummary.failed).toBe(1);
    expect(latestRunSummary.untested).toBe(2);

    // -----------------------------------------------------------------------
    // 4. Query the run — verify results and untested steps
    // -----------------------------------------------------------------------
    const runQueryData = parseResult(
      handleQuery({ run_id: run1Id }, projectPath)
    ) as {
      run: { id: string; status: string };
      results: Array<{ step_id: string; status: string }>;
      untested_steps: Array<{ id: string }>;
      progress: {
        total: number;
        passed: number;
        failed: number;
        untested: number;
      };
    };

    expect(runQueryData.run.id).toBe(run1Id);
    expect(runQueryData.run.status).toBe("completed");

    // All 3 recorded results are present
    expect(runQueryData.results).toHaveLength(3);
    const resultStepIds = runQueryData.results.map((r) => r.step_id);
    expect(resultStepIds).toContain("lc-s1");
    expect(resultStepIds).toContain("lc-s2");
    expect(resultStepIds).toContain("lc-s3");

    // 2 untested steps
    expect(runQueryData.untested_steps).toHaveLength(2);
    const untestedIds = runQueryData.untested_steps.map((s) => s.id);
    expect(untestedIds).toContain("lc-s4");
    expect(untestedIds).toContain("lc-s5");

    // Progress counts match
    expect(runQueryData.progress.total).toBe(5);
    expect(runQueryData.progress.passed).toBe(2);
    expect(runQueryData.progress.failed).toBe(1);
    expect(runQueryData.progress.untested).toBe(2);

    // -----------------------------------------------------------------------
    // 5. Record Run 2 — all 5 steps, step 3 fixed, step 5 fails
    // -----------------------------------------------------------------------
    const run2Data = parseResult(
      handleRecord(
        {
          suite_id: "lc-suite",
          run_label: "run-2-complete",
          results: [
            { step_id: "lc-s1", status: "pass" },
            { step_id: "lc-s2", status: "pass" },
            { step_id: "lc-s3", status: "pass" },
            { step_id: "lc-s4", status: "pass" },
            { step_id: "lc-s5", status: "fail", actual: "Cookie not HttpOnly" },
          ],
          _complete: true,
        },
        projectPath
      )
    ) as { run_id: string; run_progress: { passed: number; failed: number; untested: number } };

    const run2Id = run2Data.run_id;
    expect(run2Id).not.toBe(run1Id);
    expect(run2Data.run_progress.passed).toBe(4);
    expect(run2Data.run_progress.failed).toBe(1);
    expect(run2Data.run_progress.untested).toBe(0);

    // -----------------------------------------------------------------------
    // 6. Compare Run 1 vs Run 2
    // -----------------------------------------------------------------------
    const compareData = parseResult(
      handleCompare({ suite_id: "lc-suite", run_id_a: run1Id, run_id_b: run2Id }, projectPath)
    ) as {
      run_a: { id: string };
      run_b: { id: string };
      regressions: Array<{ step_id: string }>;
      improvements: Array<{ step_id: string; status_a: string; status_b: string }>;
      new_steps: Array<{ step_id: string }>;
      removed_steps: Array<{ step_id: string }>;
      persistent_failures: Array<{ step_id: string }>;
      unchanged_passes: Array<{ step_id: string }>;
      summary: {
        total_steps: number;
        regressions: number;
        improvements: number;
        persistent_failures: number;
        unchanged_passes: number;
      };
    };

    expect(compareData.run_a.id).toBe(run1Id);
    expect(compareData.run_b.id).toBe(run2Id);

    // Improvement: step 3 went from fail → pass
    expect(compareData.improvements).toHaveLength(1);
    expect(compareData.improvements[0].step_id).toBe("lc-s3");
    expect(compareData.improvements[0].status_a).toBe("fail");
    expect(compareData.improvements[0].status_b).toBe("pass");

    // No regressions — step 5 was not in run 1, so it's "new" not a regression
    expect(compareData.regressions).toHaveLength(0);

    // New steps in run 2: steps 4 and 5 (not recorded in run 1)
    const newStepIds = compareData.new_steps.map((s) => s.step_id);
    expect(newStepIds).toContain("lc-s4");
    expect(newStepIds).toContain("lc-s5");
    expect(compareData.new_steps).toHaveLength(2);

    // No removed steps
    expect(compareData.removed_steps).toHaveLength(0);

    // Summary counts are consistent with arrays
    expect(compareData.summary.regressions).toBe(compareData.regressions.length);
    expect(compareData.summary.improvements).toBe(compareData.improvements.length);
    expect(compareData.summary.persistent_failures).toBe(compareData.persistent_failures.length);
    expect(compareData.summary.unchanged_passes).toBe(compareData.unchanged_passes.length);

    // -----------------------------------------------------------------------
    // 7. Query with failing_suites — suite shows up because run 2 has a failure
    // -----------------------------------------------------------------------
    const failingData = parseResult(
      handleQuery({ status_filter: "failing_suites" }, projectPath)
    ) as { suites: Array<{ id: string }> };

    const failingSuiteIds = failingData.suites.map((s) => s.id);
    expect(failingSuiteIds).toContain("lc-suite");

    // -----------------------------------------------------------------------
    // 8. Define suite v2 — add one more step
    // -----------------------------------------------------------------------
    const v2Result = parseResult(
      handleDefine(
        {
          suite_id: "lc-suite",
          name: "Login Lifecycle Suite",
          description: "End-to-end login flow v2",
          layers: ["ui", "api", "auth"],
          steps: LIFECYCLE_STEPS_V2,
        },
        projectPath
      )
    ) as { suite_id: string; version: number; step_count: number; step_ids: string[] };

    expect(v2Result.suite_id).toBe("lc-suite");
    expect(v2Result.version).toBe(2);
    expect(v2Result.step_count).toBe(6);
    expect(v2Result.step_ids).toContain("lc-s6");

    // -----------------------------------------------------------------------
    // 9. Verify screenshot storage — step 1 screenshot was stored
    // -----------------------------------------------------------------------
    const screenshotDir = path.join(
      projectPath,
      ".codeshrike",
      "screenshots",
      "lc-suite",
      run1Id
    );
    expect(existsSync(screenshotDir)).toBe(true);

    const files = readdirSync(screenshotDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
  });
});

// -------------------------------------------------------------------------
// Multiple suites coexist
// -------------------------------------------------------------------------

describe("Multiple suites coexist", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  it("two suites can be defined, recorded, and queried independently", () => {
    // Define suite A
    handleDefine(
      {
        suite_id: "coexist-a",
        name: "Suite A",
        layers: ["ui"],
        steps: [
          { step_id: "ca-s1", name: "A step 1", layer: "ui", expected: "ok" },
          { step_id: "ca-s2", name: "A step 2", layer: "ui", expected: "ok" },
        ],
      },
      projectPath
    );

    // Define suite B
    handleDefine(
      {
        suite_id: "coexist-b",
        name: "Suite B",
        layers: ["api"],
        steps: [
          { step_id: "cb-s1", name: "B step 1", layer: "api", expected: "200" },
          { step_id: "cb-s2", name: "B step 2", layer: "api", expected: "201" },
          { step_id: "cb-s3", name: "B step 3", layer: "api", expected: "204" },
        ],
      },
      projectPath
    );

    // Record results for both
    handleRecord(
      {
        suite_id: "coexist-a",
        results: [
          { step_id: "ca-s1", status: "pass" },
          { step_id: "ca-s2", status: "fail" },
        ],
        _complete: true,
      },
      projectPath
    );

    handleRecord(
      {
        suite_id: "coexist-b",
        results: [
          { step_id: "cb-s1", status: "pass" },
          { step_id: "cb-s2", status: "pass" },
          { step_id: "cb-s3", status: "pass" },
        ],
        _complete: true,
      },
      projectPath
    );

    // Query with no filters — verify both appear
    const allData = parseResult(handleQuery({}, projectPath)) as {
      suites: Array<{ id: string; step_count: number }>;
    };

    expect(allData.suites).toHaveLength(2);
    const allIds = allData.suites.map((s) => s.id);
    expect(allIds).toContain("coexist-a");
    expect(allIds).toContain("coexist-b");

    // step_count is correct for each
    const suiteA = allData.suites.find((s) => s.id === "coexist-a")!;
    const suiteB = allData.suites.find((s) => s.id === "coexist-b")!;
    expect(suiteA.step_count).toBe(2);
    expect(suiteB.step_count).toBe(3);

    // Query with suite_id — verify isolation (suite A detail has only A steps)
    const suiteADetail = parseResult(
      handleQuery({ suite_id: "coexist-a" }, projectPath)
    ) as {
      suite: { id: string };
      steps: Array<{ id: string }>;
    };

    expect(suiteADetail.suite.id).toBe("coexist-a");
    expect(suiteADetail.steps).toHaveLength(2);
    const suiteAStepIds = suiteADetail.steps.map((s) => s.id);
    expect(suiteAStepIds).toContain("ca-s1");
    expect(suiteAStepIds).toContain("ca-s2");
    // suite B steps must not bleed in
    expect(suiteAStepIds).not.toContain("cb-s1");

    // Query suite B detail — only B steps
    const suiteBDetail = parseResult(
      handleQuery({ suite_id: "coexist-b" }, projectPath)
    ) as {
      suite: { id: string };
      steps: Array<{ id: string }>;
    };

    expect(suiteBDetail.suite.id).toBe("coexist-b");
    expect(suiteBDetail.steps).toHaveLength(3);
    const suiteBStepIds = suiteBDetail.steps.map((s) => s.id);
    expect(suiteBStepIds).not.toContain("ca-s1");
  });
});

// -------------------------------------------------------------------------
// Suite update preserves runs but uses new steps
// -------------------------------------------------------------------------

describe("Suite update preserves runs but uses new steps", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  it("old run retains its suite_version; new run captures the bumped version", () => {
    const SUITE_ID = "version-suite";

    // ---- v1: 3 steps ----
    handleDefine(
      {
        suite_id: SUITE_ID,
        name: "Version Suite",
        layers: ["ui", "api"],
        steps: [
          { step_id: "vs-s1", name: "Step 1", layer: "ui",  expected: "ok" },
          { step_id: "vs-s2", name: "Step 2", layer: "api", expected: "ok" },
          { step_id: "vs-s3", name: "Step 3", layer: "ui",  expected: "ok" },
        ],
      },
      projectPath
    );

    // Record a complete run against v1
    const v1RunData = parseResult(
      handleRecord(
        {
          suite_id: SUITE_ID,
          results: [
            { step_id: "vs-s1", status: "pass" },
            { step_id: "vs-s2", status: "pass" },
            { step_id: "vs-s3", status: "pass" },
          ],
          _complete: true,
        },
        projectPath
      )
    ) as { run_id: string };

    const v1RunId = v1RunData.run_id;

    // ---- v2: 4 steps (adds vs-s4) ----
    handleDefine(
      {
        suite_id: SUITE_ID,
        name: "Version Suite",
        layers: ["ui", "api"],
        steps: [
          { step_id: "vs-s1", name: "Step 1", layer: "ui",  expected: "ok" },
          { step_id: "vs-s2", name: "Step 2", layer: "api", expected: "ok" },
          { step_id: "vs-s3", name: "Step 3", layer: "ui",  expected: "ok" },
          { step_id: "vs-s4", name: "Step 4", layer: "api", expected: "new" },
        ],
      },
      projectPath
    );

    // Start a new run — it should be created against suite version 2
    const v2RunData = parseResult(
      handleRecord(
        {
          suite_id: SUITE_ID,
          results: [
            { step_id: "vs-s1", status: "pass" },
          ],
        },
        projectPath
      )
    ) as { run_id: string; run_progress: { total: number; untested: number } };

    const v2RunId = v2RunData.run_id;
    expect(v2RunId).not.toBe(v1RunId);

    // New run has 4 total steps (from v2 definition), 3 untested
    expect(v2RunData.run_progress.total).toBe(4);
    expect(v2RunData.run_progress.untested).toBe(3);

    // Query the v2 run — untested includes vs-s4 (the new step)
    const v2RunQuery = parseResult(
      handleQuery({ run_id: v2RunId }, projectPath)
    ) as {
      run: { suite_version: number };
      untested_steps: Array<{ id: string }>;
      progress: { total: number };
    };

    expect(v2RunQuery.run.suite_version).toBe(2);
    expect(v2RunQuery.progress.total).toBe(4);
    const untestedInV2 = v2RunQuery.untested_steps.map((s) => s.id);
    expect(untestedInV2).toContain("vs-s4");

    // Query the v1 run — it still references suite version 1.
    // NOTE: step_results are deleted when a suite's steps are replaced (replaceSteps
    // cascades to step_results to satisfy the FK constraint on step_results.step_id).
    // The run row itself is preserved with its original suite_version stamped on it.
    const v1RunQuery = parseResult(
      handleQuery({ run_id: v1RunId }, projectPath)
    ) as {
      run: { suite_version: number; id: string; status: string };
      results: Array<{ step_id: string }>;
    };

    expect(v1RunQuery.run.id).toBe(v1RunId);
    expect(v1RunQuery.run.suite_version).toBe(1);
    expect(v1RunQuery.run.status).toBe("completed");
    // The run record itself is preserved even after the suite is updated
    // (run metadata is not deleted, only step_results lose their FK target).
  });
});
