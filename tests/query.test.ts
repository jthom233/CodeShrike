import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleDefine } from "../src/tools/define.js";
import { handleRecord } from "../src/tools/record.js";
import { handleQuery } from "../src/tools/query.js";
import { createTestDir, cleanTestDir, parseResult } from "./helpers.js";

// Helper: define a basic suite
function defineSuite(
  projectPath: string,
  suiteId: string,
  name = "Test Suite",
  steps?: Array<{ step_id: string; name: string; layer: string; expected: string }>
) {
  const defaultSteps = [
    { step_id: `${suiteId}-s1`, name: "Step 1", layer: "ui", expected: "ok" },
    { step_id: `${suiteId}-s2`, name: "Step 2", layer: "api", expected: "ok" },
  ];
  return handleDefine(
    {
      suite_id: suiteId,
      name,
      layers: ["ui", "api"],
      steps: steps ?? defaultSteps,
    },
    projectPath
  );
}

// Helper: record results and complete a run
function recordAndComplete(
  projectPath: string,
  suiteId: string,
  results: Array<{ step_id: string; status: "pass" | "fail" | "skip" | "blocked" }>
) {
  return handleRecord({ suite_id: suiteId, results, _complete: true }, projectPath);
}

describe("handleQuery", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  // -------------------------------------------------------------------------
  // Mode 1: List all suites (no filters)
  // -------------------------------------------------------------------------

  it("lists all suites when called with no filters", () => {
    defineSuite(projectPath, "suite-a", "Suite Alpha");
    defineSuite(projectPath, "suite-b", "Suite Beta");

    const data = parseResult(handleQuery({}, projectPath)) as {
      suites: Array<{ id: string; name: string }>;
    };

    expect(data.suites).toHaveLength(2);
    const ids = data.suites.map((s) => s.id);
    expect(ids).toContain("suite-a");
    expect(ids).toContain("suite-b");
  });

  it("returns empty array (not an error) when no suites exist", () => {
    const data = parseResult(handleQuery({}, projectPath)) as {
      suites: unknown[];
    };

    expect(Array.isArray(data.suites)).toBe(true);
    expect(data.suites).toHaveLength(0);
  });

  it("list view includes step_count per suite", () => {
    defineSuite(projectPath, "suite-count", "Count Test", [
      { step_id: "c1", name: "Step 1", layer: "ui", expected: "ok" },
      { step_id: "c2", name: "Step 2", layer: "api", expected: "ok" },
      { step_id: "c3", name: "Step 3", layer: "logic", expected: "ok" },
    ]);

    const data = parseResult(handleQuery({}, projectPath)) as {
      suites: Array<{ id: string; step_count: number }>;
    };

    const suite = data.suites.find((s) => s.id === "suite-count");
    expect(suite?.step_count).toBe(3);
  });

  it("failing_suites filter returns only suites with fails in latest run", () => {
    // Suite A: all pass
    defineSuite(projectPath, "suite-pass", "All Pass");
    recordAndComplete(projectPath, "suite-pass", [
      { step_id: "suite-pass-s1", status: "pass" },
      { step_id: "suite-pass-s2", status: "pass" },
    ]);

    // Suite B: has a failure
    defineSuite(projectPath, "suite-fail", "Has Failures");
    recordAndComplete(projectPath, "suite-fail", [
      { step_id: "suite-fail-s1", status: "pass" },
      { step_id: "suite-fail-s2", status: "fail" },
    ]);

    const data = parseResult(
      handleQuery({ status_filter: "failing_suites" }, projectPath)
    ) as { suites: Array<{ id: string }> };

    expect(data.suites).toHaveLength(1);
    expect(data.suites[0].id).toBe("suite-fail");
  });

  it("failing_suites filter excludes suites with no runs yet", () => {
    // Suite with no runs at all
    defineSuite(projectPath, "suite-norun", "No Runs");

    const data = parseResult(
      handleQuery({ status_filter: "failing_suites" }, projectPath)
    ) as { suites: Array<{ id: string }> };

    // Should not appear since latest_run is null → no fail
    expect(data.suites.map((s) => s.id)).not.toContain("suite-norun");
  });

  // -------------------------------------------------------------------------
  // Mode 2: Suite detail (suite_id provided)
  // -------------------------------------------------------------------------

  it("returns suite detail with steps when suite_id is provided", () => {
    defineSuite(projectPath, "suite-detail", "Detail Suite", [
      { step_id: "d1", name: "Alpha", layer: "ui", expected: "visible" },
      { step_id: "d2", name: "Beta", layer: "api", expected: "200" },
    ]);

    const data = parseResult(
      handleQuery({ suite_id: "suite-detail" }, projectPath)
    ) as {
      suite: { id: string; name: string };
      steps: Array<{ id: string }>;
      scope_coverage: { intended: string[]; actual: string[]; gaps: string[] };
    };

    expect(data.suite.id).toBe("suite-detail");
    expect(data.steps).toHaveLength(2);
    expect(data.scope_coverage).toBeDefined();
  });

  it("scope_coverage reports gaps for layers with no steps", () => {
    // Suite declares 3 layers but only has steps for 2
    handleDefine(
      {
        suite_id: "suite-gap",
        name: "Gap Suite",
        layers: ["ui", "api", "logic"],
        steps: [
          { step_id: "g1", name: "UI step", layer: "ui", expected: "ok" },
          { step_id: "g2", name: "API step", layer: "api", expected: "ok" },
          // no logic step
        ],
      },
      projectPath
    );

    const data = parseResult(
      handleQuery({ suite_id: "suite-gap" }, projectPath)
    ) as {
      scope_coverage: { intended: string[]; actual: string[]; gaps: string[] };
    };

    expect(data.scope_coverage.gaps).toContain("logic");
    expect(data.scope_coverage.gaps).not.toContain("ui");
    expect(data.scope_coverage.gaps).not.toContain("api");
  });

  it("returns error when suite_id does not exist", () => {
    const data = parseResult(
      handleQuery({ suite_id: "ghost-suite" }, projectPath)
    ) as { error?: string };

    expect(data.error).toBeTruthy();
    expect(data.error).toContain("ghost-suite");
  });

  // -------------------------------------------------------------------------
  // Mode 3: Run detail (run_id provided)
  // -------------------------------------------------------------------------

  it("returns run detail with results and progress when run_id is provided", () => {
    defineSuite(projectPath, "suite-rundetail", "Run Detail Suite", [
      { step_id: "rd1", name: "S1", layer: "ui", expected: "ok" },
      { step_id: "rd2", name: "S2", layer: "api", expected: "ok" },
      { step_id: "rd3", name: "S3", layer: "logic", expected: "ok" },
    ]);

    const recordResult = parseResult(
      handleRecord(
        {
          suite_id: "suite-rundetail",
          results: [
            { step_id: "rd1", status: "pass" },
            { step_id: "rd2", status: "fail" },
          ],
        },
        projectPath
      )
    ) as { run_id: string };

    const data = parseResult(
      handleQuery({ run_id: recordResult.run_id }, projectPath)
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

    expect(data.run.id).toBe(recordResult.run_id);
    expect(data.results).toHaveLength(2);
    expect(data.progress.passed).toBe(1);
    expect(data.progress.failed).toBe(1);
    expect(data.progress.untested).toBe(1);
    expect(data.untested_steps).toHaveLength(1);
    expect(data.untested_steps[0].id).toBe("rd3");
  });

  it("untested_steps is empty when all steps have results", () => {
    defineSuite(projectPath, "suite-full", "Full Suite", [
      { step_id: "f1", name: "S1", layer: "ui", expected: "ok" },
      { step_id: "f2", name: "S2", layer: "api", expected: "ok" },
    ]);

    const recordData = parseResult(
      handleRecord(
        {
          suite_id: "suite-full",
          results: [
            { step_id: "f1", status: "pass" },
            { step_id: "f2", status: "pass" },
          ],
        },
        projectPath
      )
    ) as { run_id: string };

    const data = parseResult(
      handleQuery({ run_id: recordData.run_id }, projectPath)
    ) as { untested_steps: unknown[] };

    expect(data.untested_steps).toHaveLength(0);
  });

  it("returns error when run_id does not exist", () => {
    const data = parseResult(
      handleQuery({ run_id: "run_nonexistent_xxx" }, projectPath)
    ) as { error?: string };

    expect(data.error).toBeTruthy();
    expect(data.error).toContain("run_nonexistent_xxx");
  });

  it("status_filter=fail returns only failed results in run detail", () => {
    defineSuite(projectPath, "suite-statusfilter", "Status Filter Suite", [
      { step_id: "sf1", name: "S1", layer: "ui", expected: "ok" },
      { step_id: "sf2", name: "S2", layer: "api", expected: "ok" },
      { step_id: "sf3", name: "S3", layer: "logic", expected: "ok" },
    ]);

    const recordData = parseResult(
      handleRecord(
        {
          suite_id: "suite-statusfilter",
          results: [
            { step_id: "sf1", status: "pass" },
            { step_id: "sf2", status: "fail" },
            { step_id: "sf3", status: "pass" },
          ],
        },
        projectPath
      )
    ) as { run_id: string };

    const data = parseResult(
      handleQuery({ run_id: recordData.run_id, status_filter: "fail" }, projectPath)
    ) as { results: Array<{ step_id: string; status: string }> };

    expect(data.results).toHaveLength(1);
    expect(data.results[0].step_id).toBe("sf2");
    expect(data.results[0].status).toBe("fail");
  });
});
