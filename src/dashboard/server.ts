import express from "express";
import type { Request, Response } from "express";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listSuites,
  getSuite,
  getSteps,
  getRunsForSuite,
  getRun,
  getResults,
} from "../db/queries.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : undefined;
}

const portArg = getArg("--port");
const port = portArg ? parseInt(portArg, 10) : 8420;
const projectPath = getArg("--project-path") ?? process.cwd();

// ---------------------------------------------------------------------------
// Database (read-only)
// ---------------------------------------------------------------------------

const dbPath = path.join(projectPath, ".codeshrike", "db.sqlite");
const db = new Database(dbPath, { readonly: true });
// WAL pragma must be applied even for readers to allow concurrent access
db.pragma("journal_mode = WAL");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_LAYERS = [
  "ui",
  "api",
  "logic",
  "data",
  "filesystem",
  "auth",
  "integration",
  "performance",
] as const;

function parseRunSummary<T extends { summary: string | null }>(run: T) {
  return {
    ...run,
    summary: run.summary ? JSON.parse(run.summary) : null,
  };
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();

// GET /api/suites — list all suites with latest run
app.get("/api/suites", (_req: Request, res: Response) => {
  try {
    const suites = listSuites(db);
    const result = suites.map((s) => {
      const runs = getRunsForSuite(db, s.id, 1);
      const steps = getSteps(db, s.id);
      return {
        ...s,
        layers: JSON.parse(s.layers) as string[],
        step_count: steps.length,
        latest_run: runs[0] ? parseRunSummary(runs[0]) : null,
      };
    });
    res.json({ suites: result });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/suites/:id — suite detail with steps, runs, and scope coverage
app.get("/api/suites/:id", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const suite = getSuite(db, id);
    if (!suite) {
      res.status(404).json({ error: "Suite not found" });
      return;
    }
    const steps = getSteps(db, suite.id);
    const runs = getRunsForSuite(db, suite.id, 10);
    const intendedLayers = JSON.parse(suite.layers) as string[];
    const actualLayers: string[] = [...new Set(steps.map((s) => s.layer))];
    const gaps = intendedLayers.filter((l) => !actualLayers.includes(l));
    res.json({
      suite: { ...suite, layers: intendedLayers },
      steps,
      runs: runs.map(parseRunSummary),
      scope_coverage: { intended: intendedLayers, actual: actualLayers, gaps },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/suites/:id/runs — paginated runs for a suite
app.get("/api/suites/:id/runs", (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || "20", 10);
    const runs = getRunsForSuite(db, String(req.params.id), limit);
    res.json({ runs: runs.map(parseRunSummary) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/runs/:id — run detail with step results and progress
app.get("/api/runs/:id", (req: Request, res: Response) => {
  try {
    const run = getRun(db, String(req.params.id));
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    const results = getResults(db, run.id);
    const steps = getSteps(db, run.suite_id);
    const testedStepIds = new Set(results.map((r) => r.step_id));
    const untestedSteps = steps.filter((s) => !testedStepIds.has(s.id));
    const passed = results.filter((r) => r.status === "pass").length;
    const failed = results.filter((r) => r.status === "fail").length;
    const skipped = results.filter((r) => r.status === "skip").length;
    const blocked = results.filter((r) => r.status === "blocked").length;
    res.json({
      run: parseRunSummary(run),
      results,
      steps,
      untested_steps: untestedSteps,
      progress: {
        total: steps.length,
        passed,
        failed,
        skipped,
        blocked,
        untested: untestedSteps.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/coverage — scope coverage matrix across all suites
app.get("/api/coverage", (_req: Request, res: Response) => {
  try {
    const suites = listSuites(db);
    const matrix = suites.map((s) => {
      const steps = getSteps(db, s.id);
      const intendedLayers = JSON.parse(s.layers) as string[];
      const layerCounts: Record<string, number> = {};
      ALL_LAYERS.forEach((l) => {
        layerCounts[l] = 0;
      });
      steps.forEach((step) => {
        layerCounts[step.layer] = (layerCounts[step.layer] ?? 0) + 1;
      });
      const gaps = intendedLayers.filter((l) => layerCounts[l] === 0);
      const depth = ALL_LAYERS.filter((l) => layerCounts[l] > 0).length;
      let health: string;
      if (steps.length === 0) health = "EMPTY";
      else if (gaps.length > 0) health = "GAP";
      else if (depth <= 2) health = "SHALLOW";
      else health = "OK";
      return {
        suite_id: s.id,
        name: s.name,
        layers: layerCounts,
        intended: intendedLayers,
        gaps,
        depth,
        health,
      };
    });
    res.json({ layers: ALL_LAYERS, suites: matrix });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/compare/:a/:b — compare two runs
app.get("/api/compare/:a/:b", (req: Request, res: Response) => {
  try {
    const runA = getRun(db, String(req.params.a));
    const runB = getRun(db, String(req.params.b));
    if (!runA || !runB) {
      res.status(404).json({ error: "Run not found" });
      return;
    }
    if (runA.suite_id !== runB.suite_id) {
      res.status(400).json({ error: "Runs must be from the same suite" });
      return;
    }
    const resultsA = getResults(db, runA.id);
    const resultsB = getResults(db, runB.id);
    const steps = getSteps(db, runA.suite_id);
    const stepMap = new Map(steps.map((s) => [s.id, s]));
    const mapA = new Map(resultsA.map((r) => [r.step_id, r]));
    const mapB = new Map(resultsB.map((r) => [r.step_id, r]));
    const allStepIds = new Set<string>([
      ...steps.map((s) => s.id),
      ...resultsA.map((r) => r.step_id),
      ...resultsB.map((r) => r.step_id),
    ]);

    type ClassifiedStep = {
      step_id: string;
      step_name: string;
      layer: string;
      status_a: string | null;
      status_b: string | null;
      screenshot_a: string | null;
      screenshot_b: string | null;
    };

    const regressions: ClassifiedStep[] = [];
    const improvements: ClassifiedStep[] = [];
    const persistentFailures: ClassifiedStep[] = [];
    const unchangedPasses: ClassifiedStep[] = [];
    const newSteps: ClassifiedStep[] = [];
    const removedSteps: ClassifiedStep[] = [];
    const otherChanges: ClassifiedStep[] = [];

    for (const stepId of allStepIds) {
      const step = stepMap.get(stepId);
      const resA = mapA.get(stepId);
      const resB = mapB.get(stepId);
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
    }

    res.json({
      suite_id: runA.suite_id,
      run_a: { id: runA.id, label: runA.label, started_at: runA.started_at },
      run_b: { id: runB.id, label: runB.label, started_at: runB.started_at },
      regressions,
      improvements,
      persistent_failures: persistentFailures,
      unchanged_passes: unchangedPasses,
      new_steps: newSteps,
      removed_steps: removedSteps,
      other_changes: otherChanges,
      summary: {
        total_steps: allStepIds.size,
        regressions: regressions.length,
        improvements: improvements.length,
        persistent_failures: persistentFailures.length,
        unchanged_passes: unchangedPasses.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

// Serve screenshots from .codeshrike/screenshots/
app.use(
  "/screenshots",
  express.static(path.join(projectPath, ".codeshrike", "screenshots"))
);

// Serve SPA assets.
// At runtime this file is at dist/dashboard/server.js.
// The SPA assets live at <project-root>/dashboard/ (two levels up from dist/dashboard/).
const dashboardDir = path.resolve(__dirname, "../../dashboard");
app.use(express.static(dashboardDir));

// Fallback: serve index.html for all unmatched routes (SPA client-side routing)
app.get("/{*splat}", (_req: Request, res: Response) => {
  res.sendFile(path.join(dashboardDir, "index.html"));
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(port, () => {
  // Using stdout so the spawning process can detect startup if needed
  console.log(`CodeShrike dashboard: http://localhost:${port}`);
});
