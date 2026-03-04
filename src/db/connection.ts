import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Embedded schema — keeps the module self-contained without file bundling issues.
// The canonical human-readable version lives in schema.sql alongside this file.
const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 10000;
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

  // Remove any 0-byte db.sqlite left behind by a crashed init, along with its
  // WAL/SHM companions.  A 0-byte file is not a valid SQLite database and
  // causes confusing "database is locked" errors on the next startup.
  try {
    const stat = fs.statSync(dbPath);
    if (stat.size === 0) {
      fs.rmSync(dbPath);
      for (const suffix of ["-wal", "-shm"]) {
        const companion = dbPath + suffix;
        if (fs.existsSync(companion)) fs.rmSync(companion);
      }
    }
  } catch {
    // statSync throws if the file doesn't exist — that's fine, nothing to clean up
  }

  const db = new Database(dbPath);

  try {
    // Apply PRAGMAs individually (better-sqlite3 exec() cannot process PRAGMA
    // statements that return rows when mixed with DDL in one batch)
    db.pragma("journal_mode = WAL");
    db.pragma("busy_timeout = 10000");
    db.pragma("foreign_keys = ON");

    // Run DDL — strip the PRAGMA lines since we applied them above
    const ddl = SCHEMA_SQL.split("\n")
      .filter((line) => !line.trimStart().startsWith("PRAGMA"))
      .join("\n");
    db.exec(ddl);
  } catch (err) {
    db.close();
    for (const suffix of ["", "-wal", "-shm"]) {
      const target = dbPath + suffix;
      try {
        if (fs.existsSync(target)) fs.rmSync(target);
      } catch {
        // Best-effort cleanup
      }
    }
    throw new Error(
      "Failed to initialize CodeShrike database — removed corrupt file, please retry",
      { cause: err },
    );
  }

  dbCache.set(resolvedPath, db);
  return db;
}

/**
 * Checkpoint and close all cached database connections.
 * Called on process exit to ensure WAL files are fully checkpointed so that
 * any subsequent readonly readers (e.g. the dashboard server) can open the
 * database without hanging on stale WAL/SHM files.
 */
export function closeAllDatabases(): void {
  for (const db of dbCache.values()) {
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
    } catch {
      // Best-effort — ignore errors during shutdown
    }
  }
  dbCache.clear();
}

// Register a synchronous exit handler so cleanup runs even on normal exit,
// SIGINT, or SIGTERM (Node converts signals to 'exit' after handler runs).
process.on("exit", closeAllDatabases);
process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
