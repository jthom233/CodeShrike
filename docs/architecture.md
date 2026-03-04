# CodeShrike — Architecture

This document describes the internal architecture of the CodeShrike MCP server: the two-process model, SQLite WAL design, screenshot storage, dashboard lifecycle, and the auto-close mechanism.

Related: [Tool Reference](tools.md) | [Dashboard](dashboard.md) | [Integration Guide](integration.md)

---

## Two-Process Model

CodeShrike intentionally separates concerns across two OS processes.

```
Claude Code (agent)
    │
    │  stdio (JSON-RPC)
    ▼
┌─────────────────────────────────────────────────────────┐
│  Process 1 — MCP Server (dist/index.js)                 │
│                                                         │
│  Tools: shrike_define, shrike_record, shrike_query,     │
│         shrike_compare, shrike_dashboard                 │
│                                                         │
│  Writes to: .codeshrike/db.sqlite                       │
│  Manages:   .codeshrike/screenshots/                    │
│  Runs:      auto-close timer (60s interval)             │
│                                                         │
│  On shrike_dashboard call:                              │
│    └── spawn() ──────────────────────────────────────┐  │
└──────────────────────────────────────────────────────│──┘
                                                       │
                                                       ▼
                                     ┌─────────────────────────────────────┐
                                     │  Process 2 — Dashboard HTTP Server  │
                                     │  (dist/dashboard/server.js)         │
                                     │                                     │
                                     │  Express on localhost:8420           │
                                     │  Read-only SQLite (WAL mode)        │
                                     │  Serves: SPA, API routes,           │
                                     │          screenshots (static)       │
                                     │                                     │
                                     │  Killed when Process 1 exits        │
                                     └─────────────────────────────────────┘
                                                       │
                                                       ▼
                                              Browser (human)
```

### Why Two Processes?

**Isolation of writes.** The MCP server is the single writer to SQLite. The dashboard never writes. This eliminates any risk of concurrent write conflicts and simplifies the transaction model.

**Independent lifecycle.** The dashboard is optional and on-demand. It can crash, restart, or never be started — the MCP server doesn't care. Agents never depend on the dashboard being up.

**No build step for the UI.** The dashboard is vanilla HTML/JS served as static files. It calls REST API endpoints over HTTP. There is nothing to compile, no webpack, no React, no hydration. The dashboard directory (`dashboard/`) ships as-is.

**SQLite WAL enables safe concurrent reads.** With WAL (Write-Ahead Logging) mode, readers never block writers and writers never block readers. The dashboard can query freely while the MCP server records results simultaneously.

---

## SQLite WAL Mode

### Configuration

The database is opened with these PRAGMAs:

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
```

- **`journal_mode = WAL`**: Enables Write-Ahead Logging. Writes go to a WAL file (`.codeshrike/db.sqlite-wal`) and are checkpointed into the main database periodically. This allows multiple concurrent readers while a writer is active.
- **`busy_timeout = 5000`**: If a write lock cannot be acquired within 5 seconds, the operation fails rather than hanging indefinitely. This surfaces contention problems clearly rather than silently deadlocking.
- **`foreign_keys = ON`**: Enforces referential integrity. Deleting a suite cascades to its steps. Deleting a run cascades to its step results.

### Read-Only Dashboard Connection

The dashboard opens its own database connection with the `readonly: true` flag:

```typescript
const db = new Database(dbPath, { readonly: true });
db.pragma("journal_mode = WAL");
```

Even read-only connections must set WAL mode to participate correctly in WAL-mode concurrent access. This is a SQLite requirement.

### WAL Files

Three files coexist in `.codeshrike/`:

| File | Purpose |
|------|---------|
| `db.sqlite` | Main database file |
| `db.sqlite-wal` | WAL journal — uncommitted or recently committed writes |
| `db.sqlite-shm` | Shared memory index — enables fast WAL reader/writer coordination |

All three should be treated as a unit. Do not copy or back up just `db.sqlite` — the WAL file may contain data not yet checkpointed into the main file.

---

## Schema

Four tables. All IDs are application-generated strings (nanoid-prefixed for runs, kebab-case for suites and steps).

```sql
CREATE TABLE suites (
    id          TEXT PRIMARY KEY,        -- kebab-case, e.g. "login-flow"
    name        TEXT NOT NULL,
    description TEXT,
    layers      TEXT NOT NULL DEFAULT '[]',  -- JSON array: ["ui","api","auth"]
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE steps (
    id          TEXT PRIMARY KEY,        -- kebab-case, e.g. "submit-login-form"
    suite_id    TEXT NOT NULL REFERENCES suites(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL,        -- display order (0-indexed)
    name        TEXT NOT NULL,
    layer       TEXT NOT NULL CHECK (layer IN (
        'ui','api','logic','data','filesystem','auth','integration','performance'
    )),
    expected    TEXT NOT NULL,
    UNIQUE(suite_id, ordinal)
);

CREATE TABLE runs (
    id            TEXT PRIMARY KEY,      -- "run_" + nanoid(12)
    suite_id      TEXT NOT NULL REFERENCES suites(id),
    suite_version INTEGER NOT NULL,      -- snapshot of suite.version at run creation
    label         TEXT,                  -- optional human label
    status        TEXT NOT NULL DEFAULT 'running'
                  CHECK(status IN ('running','completed','timed_out')),
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT,
    summary       TEXT                   -- JSON: {total,passed,failed,skipped,blocked,untested}
);

CREATE TABLE step_results (
    id          TEXT PRIMARY KEY,        -- nanoid(12)
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id     TEXT NOT NULL REFERENCES steps(id),
    status      TEXT NOT NULL CHECK(status IN ('pass','fail','skip','blocked')),
    actual      TEXT,
    notes       TEXT,
    screenshot  TEXT,                    -- relative path from .codeshrike/
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(run_id, step_id)              -- one result per step per run
);
```

### Indexes

```sql
CREATE INDEX idx_steps_suite ON steps(suite_id);
CREATE INDEX idx_runs_suite ON runs(suite_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_results_run ON step_results(run_id);
```

The `idx_runs_status` index is specifically important for the auto-close timer, which queries `WHERE status = 'running'` on every tick.

### Suite Versioning

When `shrike_define` is called on an existing `suite_id`, the version is incremented:

```sql
UPDATE suites SET version = version + 1, updated_at = datetime('now') WHERE id = ?
```

Each run records `suite_version` at creation time. This allows the dashboard to show "this run was against suite version 3" even after the suite has since been updated to version 5.

**Important:** Replacing a suite's steps also deletes all `step_results` that referenced the old steps. This is necessary because SQLite's `ON DELETE CASCADE` on `steps → step_results` is not automatic when the foreign key is from `step_results.step_id` — so `replaceSteps()` explicitly deletes results before deleting steps, within a transaction.

---

## Screenshot Storage Design

### Flow

1. Agent captures a screenshot at any path (e.g. `/tmp/screenshot.png`) using `chrome-devtools-mcp`.
2. Agent calls `shrike_record` with `screenshot_path: "/tmp/screenshot.png"`.
3. CodeShrike's `storeScreenshot()` copies the file into managed storage.
4. The relative path is stored in `step_results.screenshot`.
5. The dashboard serves the file via `GET /screenshots/*` (Express static middleware).

### Path Convention

```
.codeshrike/screenshots/{suite_id}/{run_id}/{ordinal_padded}-{step_id}.png
```

Example:

```
.codeshrike/screenshots/login-flow/run_aB3kX9mNpQ4r/01-submit-valid-credentials.png
```

- `ordinal_padded` is zero-padded to 2 digits so files sort correctly in the filesystem.
- The `step_id` in the filename makes the screenshot human-readable without needing a lookup.

### Error Handling

If the source file does not exist at `screenshot_path`, `storeScreenshot()` logs a warning and returns `null`. The step result is still recorded — the screenshot field in the database is simply `null`. This prevents a missing screenshot from breaking an entire recording batch.

---

## Dashboard Server Lifecycle

### Spawn

The dashboard is spawned by `handleDashboard()` in `src/tools/dashboard.ts`:

```typescript
dashboardProcess = spawn(
  "node",
  [serverScript, "--port", String(port), "--project-path", projectPath],
  { detached: true, stdio: "ignore" }
);
dashboardProcess.unref();
```

Key details:
- **`detached: true`**: The child process becomes its own process group leader. It can outlive the parent if needed (though CodeShrike kills it on exit).
- **`stdio: "ignore"`**: The dashboard's stdout/stderr are discarded. This prevents the dashboard's console output from corrupting the MCP server's stdio channel.
- **`unref()`**: The MCP server's event loop will not wait for the dashboard process to exit. The MCP server can shut down cleanly even if the dashboard is still running.

### Singleton Pattern

`handleDashboard()` maintains a module-level singleton `dashboardProcess`. If `shrike_dashboard` is called again while a process is running (and `dashboardProcess.killed` is false), it returns the existing URL immediately rather than spawning a second server.

### Shutdown

```typescript
process.once("exit", () => {
  if (dashboardProcess && !dashboardProcess.killed) {
    dashboardProcess.kill();
  }
});
```

When the MCP server process exits (any reason), it sends `SIGTERM` to the dashboard child. This prevents orphaned HTTP servers on localhost.

---

## Auto-Close Mechanism

Runs can be abandoned if an agent crashes, loses context, or simply forgets to call `shrike_record` with `_complete: true`. The auto-close timer handles this.

### Timer

Started in `src/index.ts` immediately after the MCP server connects:

```typescript
const autoCloseInterval = startAutoCloseTimer(projectPath);
process.on('exit', () => clearInterval(autoCloseInterval));
```

Default: checks every **60 seconds**, closes runs inactive for more than **10 minutes**.

### Timeout Logic

```sql
SELECT r.*
FROM runs r
LEFT JOIN (
  SELECT run_id, MAX(recorded_at) AS last_activity
  FROM step_results
  GROUP BY run_id
) sr ON sr.run_id = r.id
WHERE r.status = 'running'
  AND (
    (sr.last_activity IS NOT NULL AND sr.last_activity < datetime('now', '-10 minutes'))
    OR
    (sr.last_activity IS NULL AND r.started_at < datetime('now', '-10 minutes'))
  )
```

Two cases:
1. **Run has results:** Last activity is the most recent `step_results.recorded_at`. If that was more than 10 minutes ago, the run is timed out.
2. **Run has no results:** A run can be created (by the first `shrike_record` call auto-creating it) and then the agent can crash before recording any results. In this case, `started_at` is used as the activity timestamp.

### Close Action

When a run is auto-closed:
1. It is marked `status = 'timed_out'`, not `'completed'`.
2. A summary is computed from the results recorded so far (with `untested` count for steps that have no result).
3. The closure is logged to stderr: `[codeshrike] Auto-closed timed out run run_xyz`.

The `timed_out` status is visible in the dashboard, distinguishing genuine abandoned runs from intentionally completed ones.

---

## Entry Point

`src/index.ts` does the following at startup:

1. Parses `--project-path` from `process.argv`.
2. Creates an `McpServer` with name `"codeshrike"` and version `"0.1.0"`.
3. Registers all 5 tools with their Zod schemas.
4. Connects via `StdioServerTransport` — this is the stdio channel the MCP client (Claude Code) communicates over.
5. Starts the auto-close timer.
6. Registers a `process.on('exit')` handler to clear the timer.

The database connection is opened lazily on first use (by `getDatabase()` in `src/db/connection.ts`), not at startup. This means the `.codeshrike/` directory and `db.sqlite` are only created when a tool is first called.
