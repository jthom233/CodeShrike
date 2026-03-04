import { getDatabase } from "../db/connection.js";
import {
  getSuite,
  listSuites,
  getSteps,
  getRun,
  getRunsForSuite,
  getResults,
} from "../db/queries.js";

type StatusFilter =
  | "all"
  | "pass"
  | "fail"
  | "skip"
  | "blocked"
  | "untested"
  | "failing_suites";

interface SummaryObject {
  passed?: number;
  failed?: number;
  skipped?: number;
  blocked?: number;
  total?: number;
  untested?: number;
  [key: string]: unknown;
}

function parseSummary(raw: string | null): SummaryObject {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as SummaryObject;
  } catch {
    return {};
  }
}

function parseLayers(raw: string): string[] {
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

export function handleQuery(
  args: {
    suite_id?: string;
    run_id?: string;
    status_filter?: StatusFilter;
    include_steps?: boolean;
    limit?: number;
  },
  projectPath: string
): { content: [{ type: "text"; text: string }] } {
  const db = getDatabase(projectPath);

  // Mode 3: run_id provided — full run detail with step results
  if (args.run_id) {
    const run = getRun(db, args.run_id);
    if (!run) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: `Run not found: ${args.run_id}` }),
          },
        ],
      };
    }

    const allResults = getResults(db, args.run_id);
    const includeSteps = args.include_steps !== false; // default true

    let steps = includeSteps ? getSteps(db, run.suite_id) : [];

    // Build result map for cross-referencing
    const resultsByStep = new Map(allResults.map((r) => [r.step_id, r]));

    // Identify untested steps (steps with no result in this run)
    const untestedSteps = steps.filter((s) => !resultsByStep.has(s.id));

    // Progress counts
    const progress = {
      total: steps.length || allResults.length,
      passed: allResults.filter((r) => r.status === "pass").length,
      failed: allResults.filter((r) => r.status === "fail").length,
      skipped: allResults.filter((r) => r.status === "skip").length,
      blocked: allResults.filter((r) => r.status === "blocked").length,
      untested: untestedSteps.length,
    };

    // Apply status filter to results
    let filteredResults = allResults;
    const sf = args.status_filter;
    if (sf && sf !== "all" && sf !== "failing_suites" && sf !== "untested") {
      filteredResults = allResults.filter((r) => r.status === sf);
    } else if (sf === "untested") {
      // Return no results — untested steps are surfaced via untested_steps field
      filteredResults = [];
    }

    const result: Record<string, unknown> = {
      run: {
        ...run,
        summary: parseSummary(run.summary),
      },
      results: filteredResults,
      untested_steps: untestedSteps,
      progress,
    };

    if (includeSteps && steps.length > 0) {
      result.steps = steps;
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }

  // Mode 2: suite_id provided, no run_id — suite detail with steps and recent runs
  if (args.suite_id) {
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

    const steps = getSteps(db, args.suite_id);
    const runs = getRunsForSuite(db, args.suite_id, args.limit ?? 5);

    const intendedLayers = parseLayers(suite.layers);
    const actualLayers = [...new Set(steps.map((s) => s.layer))];
    const gaps = intendedLayers.filter((l) => !actualLayers.includes(l as never));

    const result = {
      suite: {
        ...suite,
        layers: intendedLayers,
      },
      steps,
      runs: runs.map((r) => ({
        ...r,
        summary: parseSummary(r.summary),
      })),
      scope_coverage: {
        intended: intendedLayers,
        actual: actualLayers,
        gaps,
      },
    };

    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }

  // Mode 1: no suite_id, no run_id — list all suites with latest run summary
  const allSuites = listSuites(db);

  const suites = allSuites.map((suite) => {
    const latestRuns = getRunsForSuite(db, suite.id, 1);
    const latestRun = latestRuns[0] ?? null;
    const steps = getSteps(db, suite.id);

    return {
      ...suite,
      layers: parseLayers(suite.layers),
      latest_run: latestRun
        ? { ...latestRun, summary: parseSummary(latestRun.summary) }
        : null,
      step_count: steps.length,
    };
  });

  let filteredSuites = suites;
  if (args.status_filter === "failing_suites") {
    filteredSuites = suites.filter((s) => {
      if (!s.latest_run) return false;
      const summary = s.latest_run.summary as SummaryObject;
      return (summary.failed ?? 0) > 0;
    });
  }

  return {
    content: [{ type: "text", text: JSON.stringify({ suites: filteredSuites }) }],
  };
}
