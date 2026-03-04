import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Embedded schema — keeps the module self-contained without file bundling issues.
// The canonical human-readable version lives in schema.sql alongside this file.
// WAL journal mode is preferred for concurrent reads but is not required —
// on CIFS/NFS filesystems that lack mmap support, DELETE mode is used instead.
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

// Network filesystem types that do not support SQLite file locking
const NETWORK_FS_TYPES = new Set(["cifs", "nfs", "nfs4", "smb", "smbfs", "fuse.sshfs"]);

/**
 * Check whether the given directory lives on a network filesystem by reading
 * /proc/mounts (Linux only).  Returns false on any error or on non-Linux
 * systems, which safely defaults to the local-FS code path.
 */
export function isNetworkFilesystem(dirPath: string): boolean {
  try {
    const mounts = fs.readFileSync("/proc/mounts", "utf8");
    const resolved = path.resolve(dirPath);

    // Find the most-specific (longest) mount point that is a prefix of resolved.
    let bestMount = "";
    let bestFsType = "";

    for (const line of mounts.split("\n")) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;
      const mountPoint = parts[1];
      const fsType = parts[2];

      // The mount point must be a path prefix of the resolved directory.
      const normalised = mountPoint.endsWith("/") ? mountPoint : mountPoint + "/";
      const resolvedSlash = resolved.endsWith("/") ? resolved : resolved + "/";

      // Use >= so that a real mount (e.g. cifs) that appears after an autofs
      // stub at the same mount point correctly overrides the stub entry.
      if (resolvedSlash.startsWith(normalised) && mountPoint.length >= bestMount.length) {
        bestMount = mountPoint;
        bestFsType = fsType;
      }
    }

    return NETWORK_FS_TYPES.has(bestFsType);
  } catch {
    // /proc/mounts missing (non-Linux) or unreadable — assume local
    return false;
  }
}

/**
 * Return the absolute path to the SQLite database file for the given project.
 *
 * - Local filesystem: `<projectPath>/.codeshrike/db.sqlite`
 * - Network filesystem (CIFS/NFS/…): `~/.local/share/codeshrike/<hash>/db.sqlite`
 *   where <hash> is the first 12 hex chars of SHA-256 of the resolved project path.
 *
 * The parent directory is created with mkdirSync before returning.
 */
export function getDbPath(projectPath: string): string {
  const resolved = path.resolve(projectPath);

  if (isNetworkFilesystem(resolved)) {
    const hash = crypto
      .createHash("sha256")
      .update(resolved)
      .digest("hex")
      .slice(0, 12);
    const localDir = path.join(os.homedir(), ".local", "share", "codeshrike", hash);
    fs.mkdirSync(localDir, { recursive: true });
    return path.join(localDir, "db.sqlite");
  }

  const shrineDir = path.join(resolved, ".codeshrike");
  fs.mkdirSync(shrineDir, { recursive: true });
  return path.join(shrineDir, "db.sqlite");
}

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

  // Always ensure .codeshrike/ exists in the project dir for screenshots + .gitignore,
  // even when the database lives elsewhere (network filesystem case).
  const shrineDir = path.join(resolvedPath, ".codeshrike");
  fs.mkdirSync(shrineDir, { recursive: true });

  // Add a .gitignore that ignores everything inside
  const gitignorePath = path.join(shrineDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, "*\n", "utf8");
  }

  // Determine database location — use local filesystem when the project lives on
  // a network mount (CIFS/NFS) because SQLite file locking doesn't work there.
  const dbPath = getDbPath(resolvedPath);
  if (isNetworkFilesystem(resolvedPath)) {
    console.error(`[codeshrike] Database stored locally at ${dbPath} (project on network filesystem)`);
  }

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
    // statements that return rows when mixed with DDL in one batch).
    // Try WAL mode for concurrent read support (dashboard).
    // Falls back to DELETE mode on filesystems that don't support WAL (CIFS, NFS).
    try {
      const result = db.pragma("journal_mode = WAL");
      const mode = Array.isArray(result) ? result[0]?.journal_mode : result;
      if (mode !== "wal") {
        console.error(`[codeshrike] WAL mode unavailable (got "${mode}"), using DELETE journal mode.`);
      }
    } catch {
      console.error("[codeshrike] WAL mode failed (filesystem may not support it), using DELETE journal mode.");
    }
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
      // Only checkpoint if we are actually in WAL mode — on CIFS/NFS the database
      // may have fallen back to DELETE mode, which has no WAL file to checkpoint.
      const modeResult = db.pragma("journal_mode") as { journal_mode: string }[];
      const mode = Array.isArray(modeResult)
        ? modeResult[0]?.journal_mode
        : (modeResult as unknown as string);
      if (mode === "wal") {
        db.pragma("wal_checkpoint(TRUNCATE)");
      }
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
