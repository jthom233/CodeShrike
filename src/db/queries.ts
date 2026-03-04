import type Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Suite {
  id: string;
  name: string;
  description: string | null;
  /** JSON-encoded string array — parse with JSON.parse */
  layers: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Step {
  id: string;
  suite_id: string;
  ordinal: number;
  name: string;
  layer:
    | "ui"
    | "api"
    | "logic"
    | "data"
    | "filesystem"
    | "auth"
    | "integration"
    | "performance";
  expected: string;
}

export interface Run {
  id: string;
  suite_id: string;
  suite_version: number;
  label: string | null;
  status: "running" | "completed" | "timed_out";
  started_at: string;
  finished_at: string | null;
  /** JSON-encoded summary object — parse with JSON.parse */
  summary: string | null;
}

export interface StepResult {
  id: string;
  run_id: string;
  step_id: string;
  status: "pass" | "fail" | "skip" | "blocked";
  actual: string | null;
  notes: string | null;
  screenshot: string | null;
  recorded_at: string;
}

// ---------------------------------------------------------------------------
// Suite operations
// ---------------------------------------------------------------------------

export function createSuite(
  db: Database.Database,
  suite: { id: string; name: string; description?: string; layers: string[] }
): void {
  const stmt = db.prepare<[string, string, string | null, string]>(`
    INSERT INTO suites (id, name, description, layers)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(
    suite.id,
    suite.name,
    suite.description ?? null,
    JSON.stringify(suite.layers)
  );
}

export function updateSuite(
  db: Database.Database,
  suite: { id: string; name: string; description?: string; layers: string[] }
): void {
  const stmt = db.prepare<[string, string | null, string, string]>(`
    UPDATE suites
    SET name        = ?,
        description = ?,
        layers      = ?,
        version     = version + 1,
        updated_at  = datetime('now')
    WHERE id = ?
  `);
  stmt.run(
    suite.name,
    suite.description ?? null,
    JSON.stringify(suite.layers),
    suite.id
  );
}

export function getSuite(
  db: Database.Database,
  id: string
): Suite | undefined {
  const stmt = db.prepare<[string], Suite>(`SELECT * FROM suites WHERE id = ?`);
  return stmt.get(id);
}

export function listSuites(db: Database.Database): Suite[] {
  const stmt = db.prepare<[], Suite>(
    `SELECT * FROM suites ORDER BY created_at DESC`
  );
  return stmt.all();
}

// ---------------------------------------------------------------------------
// Step operations
// ---------------------------------------------------------------------------

export function replaceSteps(
  db: Database.Database,
  suiteId: string,
  steps: {
    id: string;
    ordinal: number;
    name: string;
    layer: Step["layer"];
    expected: string;
  }[]
): void {
  // Delete step_results that reference steps belonging to this suite first,
  // to avoid a FK constraint violation when steps are replaced on a suite that
  // already has recorded runs. step_results.step_id has no ON DELETE CASCADE.
  const deleteResultsStmt = db.prepare<[string]>(`
    DELETE FROM step_results
    WHERE step_id IN (SELECT id FROM steps WHERE suite_id = ?)
  `);
  const deleteStmt = db.prepare<[string]>(
    `DELETE FROM steps WHERE suite_id = ?`
  );
  const insertStmt = db.prepare<
    [string, string, number, string, string, string]
  >(`
    INSERT INTO steps (id, suite_id, ordinal, name, layer, expected)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const txn = db.transaction(() => {
    deleteResultsStmt.run(suiteId);
    deleteStmt.run(suiteId);
    for (const step of steps) {
      insertStmt.run(
        step.id,
        suiteId,
        step.ordinal,
        step.name,
        step.layer,
        step.expected
      );
    }
  });

  txn();
}

export function getSteps(db: Database.Database, suiteId: string): Step[] {
  const stmt = db.prepare<[string], Step>(
    `SELECT * FROM steps WHERE suite_id = ? ORDER BY ordinal ASC`
  );
  return stmt.all(suiteId);
}

// ---------------------------------------------------------------------------
// Run operations
// ---------------------------------------------------------------------------

export function createRun(
  db: Database.Database,
  run: { id: string; suiteId: string; suiteVersion: number; label?: string }
): void {
  const stmt = db.prepare<[string, string, number, string | null]>(`
    INSERT INTO runs (id, suite_id, suite_version, label)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(run.id, run.suiteId, run.suiteVersion, run.label ?? null);
}

export function getActiveRun(
  db: Database.Database,
  suiteId: string
): Run | undefined {
  const stmt = db.prepare<[string], Run>(`
    SELECT * FROM runs
    WHERE suite_id = ? AND status = 'running'
    ORDER BY started_at DESC
    LIMIT 1
  `);
  return stmt.get(suiteId);
}

export function closeRun(
  db: Database.Database,
  runId: string,
  status: "completed" | "timed_out",
  summary: object
): void {
  const stmt = db.prepare<[string, string, string]>(`
    UPDATE runs
    SET status      = ?,
        finished_at = datetime('now'),
        summary     = ?
    WHERE id = ?
  `);
  stmt.run(status, JSON.stringify(summary), runId);
}

export function getRun(
  db: Database.Database,
  runId: string
): Run | undefined {
  const stmt = db.prepare<[string], Run>(`SELECT * FROM runs WHERE id = ?`);
  return stmt.get(runId);
}

export function getRunsForSuite(
  db: Database.Database,
  suiteId: string,
  limit = 10
): Run[] {
  const stmt = db.prepare<[string, number], Run>(`
    SELECT * FROM runs
    WHERE suite_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `);
  return stmt.all(suiteId, limit);
}

/**
 * Return runs where status = 'running' and the most-recent step_result
 * recorded_at is older than timeoutMinutes (or no results at all and
 * started_at is older than timeoutMinutes).
 */
export function getTimedOutRuns(
  db: Database.Database,
  timeoutMinutes: number
): Run[] {
  const stmt = db.prepare<[number, number], Run>(`
    SELECT r.*
    FROM runs r
    LEFT JOIN (
      SELECT run_id, MAX(recorded_at) AS last_activity
      FROM step_results
      GROUP BY run_id
    ) sr ON sr.run_id = r.id
    WHERE r.status = 'running'
      AND (
        (sr.last_activity IS NOT NULL AND
         sr.last_activity < datetime('now', '-' || ? || ' minutes'))
        OR
        (sr.last_activity IS NULL AND
         r.started_at   < datetime('now', '-' || ? || ' minutes'))
      )
  `);
  return stmt.all(timeoutMinutes, timeoutMinutes);
}

// ---------------------------------------------------------------------------
// Step result operations
// ---------------------------------------------------------------------------

export function recordResult(
  db: Database.Database,
  result: {
    id: string;
    runId: string;
    stepId: string;
    status: StepResult["status"];
    actual?: string;
    notes?: string;
    screenshot?: string;
  }
): void {
  const stmt = db.prepare<
    [string, string, string, string, string | null, string | null, string | null]
  >(`
    INSERT OR REPLACE INTO step_results
      (id, run_id, step_id, status, actual, notes, screenshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    result.id,
    result.runId,
    result.stepId,
    result.status,
    result.actual ?? null,
    result.notes ?? null,
    result.screenshot ?? null
  );
}

export function getResults(
  db: Database.Database,
  runId: string
): StepResult[] {
  const stmt = db.prepare<[string], StepResult>(`
    SELECT * FROM step_results WHERE run_id = ? ORDER BY recorded_at ASC
  `);
  return stmt.all(runId);
}

export function getResultsByStep(
  db: Database.Database,
  runId: string,
  stepId: string
): StepResult | undefined {
  const stmt = db.prepare<[string, string], StepResult>(`
    SELECT * FROM step_results WHERE run_id = ? AND step_id = ?
  `);
  return stmt.get(runId, stepId);
}
