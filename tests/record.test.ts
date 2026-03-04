import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "path";
import { readdirSync } from "fs";
import { handleDefine } from "../src/tools/define.js";
import { handleRecord } from "../src/tools/record.js";
import { createTestDir, cleanTestDir, createFakePng, parseResult } from "./helpers.js";

// Shared helper: define a simple 3-step suite in the given projectPath
function defineSuite(projectPath: string, suiteId = "suite-001") {
  return handleDefine(
    {
      suite_id: suiteId,
      name: "Test Suite",
      layers: ["ui", "api"],
      steps: [
        { step_id: "step-1", name: "Load page", layer: "ui", expected: "page loads" },
        { step_id: "step-2", name: "Login", layer: "api", expected: "200 OK" },
        { step_id: "step-3", name: "Dashboard", layer: "ui", expected: "dashboard visible" },
      ],
    },
    projectPath
  );
}

describe("handleRecord", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  it("auto-creates a run on first recording and returns run_id", () => {
    defineSuite(projectPath);

    const result = handleRecord(
      {
        suite_id: "suite-001",
        results: [
          { step_id: "step-1", status: "pass" },
        ],
      },
      projectPath
    );

    const data = parseResult(result) as { run_id: string; recorded: number };

    expect(data.run_id).toBeTruthy();
    expect(typeof data.run_id).toBe("string");
    expect(data.run_id).toMatch(/^run_/);
    expect(data.recorded).toBe(1);
  });

  it("subsequent recordings in same session reuse the same run_id", () => {
    defineSuite(projectPath);

    const first = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [{ step_id: "step-1", status: "pass" }],
        },
        projectPath
      )
    ) as { run_id: string };

    const second = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [{ step_id: "step-2", status: "fail" }],
        },
        projectPath
      )
    ) as { run_id: string };

    expect(second.run_id).toBe(first.run_id);
  });

  it("reports correct progress counts after recording", () => {
    defineSuite(projectPath);

    const data = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [
            { step_id: "step-1", status: "pass" },
            { step_id: "step-2", status: "fail" },
            { step_id: "step-3", status: "skip" },
          ],
        },
        projectPath
      )
    ) as {
      run_progress: {
        total: number;
        passed: number;
        failed: number;
        skipped: number;
        blocked: number;
        untested: number;
      };
    };

    expect(data.run_progress.total).toBe(3);
    expect(data.run_progress.passed).toBe(1);
    expect(data.run_progress.failed).toBe(1);
    expect(data.run_progress.skipped).toBe(1);
    expect(data.run_progress.blocked).toBe(0);
    expect(data.run_progress.untested).toBe(0);
  });

  it("remaining_steps lists steps without results", () => {
    defineSuite(projectPath);

    // Record only the first step
    const data = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [{ step_id: "step-1", status: "pass" }],
        },
        projectPath
      )
    ) as {
      remaining_steps: Array<{ step_id: string; name: string; layer: string }>;
      run_progress: { untested: number };
    };

    expect(data.remaining_steps).toHaveLength(2);
    const remainingIds = data.remaining_steps.map((s) => s.step_id);
    expect(remainingIds).toContain("step-2");
    expect(remainingIds).toContain("step-3");
    expect(remainingIds).not.toContain("step-1");
    expect(data.run_progress.untested).toBe(2);
  });

  it("_complete flag closes the run and subsequent record creates a new run", () => {
    defineSuite(projectPath);

    // Record all steps and close run
    const firstRun = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [
            { step_id: "step-1", status: "pass" },
            { step_id: "step-2", status: "pass" },
            { step_id: "step-3", status: "pass" },
          ],
          _complete: true,
        },
        projectPath
      )
    ) as { run_id: string };

    // New recording should create a new run
    const secondRun = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [{ step_id: "step-1", status: "fail" }],
        },
        projectPath
      )
    ) as { run_id: string };

    expect(secondRun.run_id).not.toBe(firstRun.run_id);
    expect(secondRun.run_id).toMatch(/^run_/);
  });

  it("unknown step_id is silently skipped — does not crash", () => {
    defineSuite(projectPath);

    // Mix of valid and invalid step IDs
    const data = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [
            { step_id: "step-1", status: "pass" },
            { step_id: "NONEXISTENT-STEP", status: "fail" }, // ghost step
          ],
        },
        projectPath
      )
    ) as {
      run_id: string;
      recorded: number;
      run_progress: { passed: number; failed: number };
    };

    // Should not throw, should still return a run_id
    expect(data.run_id).toBeTruthy();
    // recorded reflects args.results.length (includes the skipped one)
    expect(data.recorded).toBe(2);
    // Only the valid step was actually written to DB
    expect(data.run_progress.passed).toBe(1);
    expect(data.run_progress.failed).toBe(0); // ghost step was skipped
  });

  it("screenshot_path — existing file is copied to managed storage", () => {
    defineSuite(projectPath);

    // Create a real file to copy
    const screenshotSrc = path.join(projectPath, "screenshot.png");
    createFakePng(screenshotSrc);

    const data = parseResult(
      handleRecord(
        {
          suite_id: "suite-001",
          results: [
            {
              step_id: "step-1",
              status: "pass",
              screenshot_path: screenshotSrc,
            },
          ],
        },
        projectPath
      )
    ) as { run_id: string };

    // Verify the destination file was created in .codeshrike/screenshots/
    const destDir = path.join(
      projectPath,
      ".codeshrike",
      "screenshots",
      "suite-001",
      data.run_id
    );
    const files = readdirSync(destDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.png$/);
  });

  it("screenshot_path — nonexistent file is silently skipped, no crash", () => {
    defineSuite(projectPath);

    expect(() =>
      handleRecord(
        {
          suite_id: "suite-001",
          results: [
            {
              step_id: "step-1",
              status: "pass",
              screenshot_path: "/this/path/does/not/exist/shot.png",
            },
          ],
        },
        projectPath
      )
    ).not.toThrow();
  });

  it("returns error object when suite_id does not exist", () => {
    // Don't create any suite first
    const data = parseResult(
      handleRecord(
        {
          suite_id: "ghost-suite",
          results: [{ step_id: "s1", status: "pass" }],
        },
        projectPath
      )
    ) as { error?: string };

    expect(data.error).toBeTruthy();
    expect(data.error).toContain("ghost-suite");
  });

  it("all four valid statuses are accepted", () => {
    defineSuite(projectPath);

    // Need a 4-step suite for this test
    const pp = createTestDir();
    try {
      handleDefine(
        {
          suite_id: "suite-statuses",
          name: "Statuses",
          layers: ["ui"],
          steps: [
            { step_id: "s1", name: "pass step", layer: "ui", expected: "ok" },
            { step_id: "s2", name: "fail step", layer: "ui", expected: "ok" },
            { step_id: "s3", name: "skip step", layer: "ui", expected: "ok" },
            { step_id: "s4", name: "blocked step", layer: "ui", expected: "ok" },
          ],
        },
        pp
      );

      const data = parseResult(
        handleRecord(
          {
            suite_id: "suite-statuses",
            results: [
              { step_id: "s1", status: "pass" },
              { step_id: "s2", status: "fail" },
              { step_id: "s3", status: "skip" },
              { step_id: "s4", status: "blocked" },
            ],
          },
          pp
        )
      ) as {
        run_progress: {
          passed: number;
          failed: number;
          skipped: number;
          blocked: number;
        };
      };

      expect(data.run_progress.passed).toBe(1);
      expect(data.run_progress.failed).toBe(1);
      expect(data.run_progress.skipped).toBe(1);
      expect(data.run_progress.blocked).toBe(1);
    } finally {
      cleanTestDir(pp);
    }
  });
});
