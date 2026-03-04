import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleDefine } from "../src/tools/define.js";
import { createTestDir, cleanTestDir, parseResult } from "./helpers.js";

describe("handleDefine", () => {
  let projectPath: string;

  beforeEach(() => {
    projectPath = createTestDir();
  });

  afterEach(() => {
    cleanTestDir(projectPath);
  });

  it("creates a new suite with correct version and step_count", () => {
    const result = handleDefine(
      {
        suite_id: "suite-001",
        name: "Login Flow",
        layers: ["ui", "api"],
        steps: [
          {
            step_id: "step-1",
            name: "Enter credentials",
            layer: "ui",
            expected: "Fields accept input",
          },
          {
            step_id: "step-2",
            name: "Submit form",
            layer: "api",
            expected: "API returns 200",
          },
        ],
      },
      projectPath
    );

    const data = parseResult(result) as {
      suite_id: string;
      version: number;
      step_count: number;
      step_ids: string[];
    };

    expect(data.suite_id).toBe("suite-001");
    expect(data.version).toBe(1);
    expect(data.step_count).toBe(2);
    expect(data.step_ids).toEqual(["step-1", "step-2"]);
  });

  it("increments version to 2 when updating an existing suite", () => {
    // First call creates the suite (version 1)
    handleDefine(
      {
        suite_id: "suite-update",
        name: "Original Name",
        layers: ["ui"],
        steps: [
          {
            step_id: "step-a",
            name: "Old step",
            layer: "ui",
            expected: "old expected",
          },
        ],
      },
      projectPath
    );

    // Second call with same suite_id updates it
    const result = handleDefine(
      {
        suite_id: "suite-update",
        name: "Updated Name",
        layers: ["ui", "logic"],
        steps: [
          {
            step_id: "step-b",
            name: "New step 1",
            layer: "ui",
            expected: "new expected 1",
          },
          {
            step_id: "step-c",
            name: "New step 2",
            layer: "logic",
            expected: "new expected 2",
          },
        ],
      },
      projectPath
    );

    const data = parseResult(result) as {
      suite_id: string;
      version: number;
      step_count: number;
      step_ids: string[];
    };

    expect(data.version).toBe(2);
    expect(data.step_count).toBe(2);
    // Old step should be gone, new steps present
    expect(data.step_ids).toEqual(["step-b", "step-c"]);
    expect(data.step_ids).not.toContain("step-a");
  });

  it("rejects steps with invalid layer — DB CHECK constraint throws", () => {
    // The layer CHECK constraint in SQLite will fire and throw.
    // handleDefine has no application-level validation — it lets the DB error bubble up.
    expect(() =>
      handleDefine(
        {
          suite_id: "suite-badlayer",
          name: "Bad Layer Suite",
          layers: ["ui"],
          steps: [
            {
              step_id: "step-bad",
              name: "Bad step",
              layer: "invalid_layer_xyz", // not in CHECK list
              expected: "should reject",
            },
          ],
        },
        projectPath
      )
    ).toThrow();
  });

  it("creates a suite with zero steps", () => {
    const result = handleDefine(
      {
        suite_id: "suite-empty",
        name: "Empty Suite",
        layers: ["ui"],
        steps: [],
      },
      projectPath
    );

    const data = parseResult(result) as {
      step_count: number;
      step_ids: string[];
    };

    expect(data.step_count).toBe(0);
    expect(data.step_ids).toEqual([]);
  });

  it("preserves suite_id in the response", () => {
    const suiteId = "my-unique-suite-id-abc123";

    const result = handleDefine(
      {
        suite_id: suiteId,
        name: "ID Preservation Test",
        layers: ["data"],
        steps: [
          {
            step_id: "s1",
            name: "data step",
            layer: "data",
            expected: "data written",
          },
        ],
      },
      projectPath
    );

    const data = parseResult(result) as { suite_id: string };
    expect(data.suite_id).toBe(suiteId);
  });

  it("replaces ALL old steps when updating — no orphan steps survive", () => {
    // Create with 3 steps
    handleDefine(
      {
        suite_id: "suite-replace",
        name: "Replace Test",
        layers: ["ui"],
        steps: [
          { step_id: "s1", name: "Step 1", layer: "ui", expected: "E1" },
          { step_id: "s2", name: "Step 2", layer: "ui", expected: "E2" },
          { step_id: "s3", name: "Step 3", layer: "ui", expected: "E3" },
        ],
      },
      projectPath
    );

    // Update with only 1 step (different ID)
    const result = handleDefine(
      {
        suite_id: "suite-replace",
        name: "Replace Test",
        layers: ["ui"],
        steps: [
          { step_id: "s-new", name: "Only Step", layer: "ui", expected: "E" },
        ],
      },
      projectPath
    );

    const data = parseResult(result) as {
      step_count: number;
      step_ids: string[];
    };

    expect(data.step_count).toBe(1);
    expect(data.step_ids).toEqual(["s-new"]);
  });

  it("accepts all valid layer values without error", () => {
    const validLayers = [
      "ui",
      "api",
      "logic",
      "data",
      "filesystem",
      "auth",
      "integration",
      "performance",
    ] as const;

    for (const layer of validLayers) {
      const stepPath = createTestDir();
      try {
        expect(() =>
          handleDefine(
            {
              suite_id: `suite-layer-${layer}`,
              name: `Layer ${layer}`,
              layers: [layer],
              steps: [
                {
                  step_id: `step-${layer}`,
                  name: "valid step",
                  layer,
                  expected: "ok",
                },
              ],
            },
            stepPath
          )
        ).not.toThrow();
      } finally {
        cleanTestDir(stepPath);
      }
    }
  });
});
