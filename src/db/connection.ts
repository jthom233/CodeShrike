import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Embedded schema — keeps the module self-contained without file bundling issues.
// The canonical human-readable version lives in schema.sql alongside this file.
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suites (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    layers      TEXT NOT NULL DEFAULT '[]',
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS steps (
    id          TEXT PRIMARY KEY,
    suite_id    TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    layer       TEXT NOT NULL CHECK (layer IN (
        'ui','api','logic','data','filesystem','auth','integration','performance'
    )),
    expected    TEXT NOT NULL,
    UNIQUE(suite_id, ordinal)
);

CREATE TABLE IF NOT EXISTS runs (
    id            TEXT PRIMARY KEY,
    suite_id      TEXT NOT NULL REFERENCES suites(id),
    suite_version INTEGER NOT NULL,
    label         TEXT,
    status        TEXT NOT NULL DEFAULT 'running'
                  CHECK(status IN ('running','completed','timed_out')),
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT,
    summary       TEXT
);

CREATE TABLE IF NOT EXISTS step_results (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id     TEXT NOT NULL REFERENCES steps(id),
    status      TEXT NOT NULL CHECK(status IN ('pass','fail','skip','blocked')),
    actual      TEXT,
    notes       TEXT,
    screenshot  TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(run_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_steps_suite ON steps(suite_id);
CREATE INDEX IF NOT EXISTS idx_runs_suite ON runs(suite_id);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
CREATE INDEX IF NOT EXISTS idx_results_run ON step_results(run_id);
`;

// Singleton cache: one Database instance per resolved project path
const dbCache = new Map<string, Database.Database>();

/**
 * Get (or create) a SQLite database for the given project path.
 * Creates .codeshrike/ directory and initialises the schema on first call.
 * Subsequent calls with the same path return the cached instance.
 */
export function getDatabase(projectPath: string): Database.Database {
  const resolvedPath = path.resolve(projectPath);

  const cached = dbCache.get(resolvedPath);
  if (cached) return cached;

  // Ensure .codeshrike/ directory exists
  const shrineDir = path.join(resolvedPath, ".codeshrike");
  fs.mkdirSync(shrineDir, { recursive: true });

  // Add a .gitignore that ignores everything inside
  const gitignorePath = path.join(shrineDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf8");
  }

  // Open the database
  const dbPath = path.join(shrineDir, "db.sqlite");
  const db = new Database(dbPath);

  // Apply PRAGMAs individually (better-sqlite3 exec() cannot process PRAGMA
  // statements that return rows when mixed with DDL in one batch)
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  // Run DDL — strip the PRAGMA lines since we applied them above
  const ddl = SCHEMA_SQL.split("\n")
    .filter((line) => !line.trimStart().startsWith("PRAGMA"))
    .join("\n");
  db.exec(ddl);

  dbCache.set(resolvedPath, db);
  return db;
}
