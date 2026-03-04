# CodeShrike — Technical Implementation Plan

## Architecture

### Two-Process Model

```
Claude Code (orchestrator/agents)
    │
    ├── stdio ──── CodeShrike MCP Server (Process 1)
    │                  │
    │                  ├── SQLite (WAL mode)
    │                  ├── Screenshot filesystem
    │                  └── Spawns ──── Dashboard HTTP Server (Process 2)
    │                                      │
    │                                      ├── Express on localhost:8420
    │                                      ├── Reads SQLite (read-only)
    │                                      └── Serves screenshots via static
    │
    └── stdio ──── chrome-devtools-mcp (existing)
```

**Process 1 (MCP Server):** Receives tool calls via stdio. Manages SQLite database and screenshot storage. Only writer to the database.

**Process 2 (Dashboard):** Spawned on demand by `shrike_dashboard` tool. HTTP server on localhost serving a vanilla HTML/JS SPA. Read-only access to SQLite via WAL mode. Killed when MCP server exits.

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| MCP Server | TypeScript + @modelcontextprotocol/sdk | Official SDK, matches chrome-devtools-mcp ecosystem |
| Database | better-sqlite3 (WAL mode) | Zero-dependency, concurrent read/write, crash-resilient |
| Schema validation | Zod | Already used by MCP SDK |
| ID generation | nanoid (prefixed) | Short, URL-safe, collision-resistant |
| Dashboard server | Express 5 | Familiar, stable, static file serving |
| Dashboard SPA | Vanilla HTML/JS/CSS | No build step, no framework dependency |
| Screenshot handling | sharp (thumbnails), fs (copy/move) | Fast WebP thumbnail generation |
| Package manager | npm | Standard for TypeScript MCP servers |

### Storage Layout

```
{project}/.codeshrike/
├── db.sqlite              # Main database (WAL mode)
├── db.sqlite-wal          # WAL file (auto-managed)
├── db.sqlite-shm          # Shared memory (auto-managed)
├── screenshots/
│   └── {suite_id}/
│       └── {run_id}/
│           └── {step_ordinal}-{step_id}.png
└── .gitignore             # Auto-created: ignore everything
```

### SQLite Schema

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE suites (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    layers      TEXT NOT NULL DEFAULT '[]',    -- JSON array of scope layer strings
    version     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE steps (
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

CREATE TABLE runs (
    id            TEXT PRIMARY KEY,
    suite_id      TEXT NOT NULL REFERENCES suites(id),
    suite_version INTEGER NOT NULL,
    label         TEXT,
    status        TEXT NOT NULL DEFAULT 'running'
                  CHECK(status IN ('running','completed','timed_out')),
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at   TEXT,
    summary       TEXT    -- JSON: {total, passed, failed, skipped, blocked, untested}
);

CREATE TABLE step_results (
    id          TEXT PRIMARY KEY,
    run_id      TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id     TEXT NOT NULL REFERENCES steps(id),
    status      TEXT NOT NULL CHECK(status IN ('pass','fail','skip','blocked')),
    actual      TEXT,
    notes       TEXT,
    screenshot  TEXT,     -- relative path to screenshot file
    recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(run_id, step_id)
);

CREATE INDEX idx_steps_suite ON steps(suite_id);
CREATE INDEX idx_runs_suite ON runs(suite_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_results_run ON step_results(run_id);
```

### Tool Implementation

#### shrike_define
1. Check if suite_id exists
2. If exists: update name/description/layers, delete old steps, insert new steps, bump version
3. If not exists: create suite, insert steps
4. Return suite_id, version, step_count, step_ids[]

#### shrike_record
1. Validate suite_id exists
2. Find active run (status='running') for suite, or create new one
3. For each result in batch:
   a. Validate step_id exists in suite
   b. If screenshot_path provided, copy file to managed storage
   c. Insert/upsert step_result
4. If _complete flag: close run, compute summary + scope coverage
5. Return run_id, recorded count, progress, remaining_steps

**Auto-close mechanism:** A setInterval (every 60s) checks for runs where last step_result.recorded_at is older than timeout (default 10 min). Closes them with status='timed_out'.

#### shrike_query
1. Build query based on filters (suite_id, run_id, status_filter)
2. If no suite_id: return all suites with latest run summary
3. If suite_id but no run_id: return suite detail with steps + latest N runs
4. If run_id: return full run with all step_results
5. Smart defaults: include_steps=true for single suite, false for listing

#### shrike_compare
1. Resolve run_id_a and run_id_b (default to last two runs)
2. Join step_results for both runs on step_id
3. Classify each step: regression (pass→fail), improvement (fail→pass), persistent_failure, unchanged
4. Return classified lists with screenshot references

#### shrike_dashboard
1. Check if dashboard process already running
2. If not: spawn dashboard-server.js as detached child process
3. Open browser via `open` package
4. Return URL

### Dashboard Architecture

**API Routes:**
```
GET /                          → SPA index.html
GET /api/suites                → list suites with latest run
GET /api/suites/:id            → suite detail with steps
GET /api/suites/:id/runs       → paginated runs
GET /api/runs/:id              → run detail with step results
GET /api/coverage              → scope coverage matrix data
GET /api/compare/:a/:b         → run comparison
GET /screenshots/*             → serve screenshot files (express.static)
```

**SPA Views (vanilla HTML/JS):**
1. Suite Library — table of suites with scope layer indicators and health badges
2. Suite Detail — steps list + scope coverage + run history
3. Run Detail — step navigator strip + screenshot + expected/actual + notes
4. Coverage Matrix — suites × layers grid with gap highlighting

**Keyboard navigation:** j/k (navigate), Enter (open), Left/Right (prev/next step), / (filter), Tab (switch views), ? (shortcuts)

### Project Structure

```
codeshrike/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry: MCP server + stdio transport
│   ├── tools/
│   │   ├── define.ts         # shrike_define
│   │   ├── record.ts         # shrike_record
│   │   ├── query.ts          # shrike_query
│   │   ├── compare.ts        # shrike_compare
│   │   └── dashboard.ts      # shrike_dashboard
│   ├── db/
│   │   ├── connection.ts     # SQLite connection + WAL + migrations
│   │   ├── schema.sql        # DDL
│   │   └── queries.ts        # Prepared statement wrappers
│   ├── storage/
│   │   └── screenshots.ts    # File copy, path resolution
│   └── dashboard/
│       ├── server.ts         # Express HTTP server (child process)
│       └── routes.ts         # API routes
├── dashboard/
│   ├── index.html            # SPA shell
│   ├── app.js                # Application logic
│   ├── components/
│   │   ├── suite-list.js
│   │   ├── suite-detail.js
│   │   ├── run-viewer.js
│   │   └── coverage-matrix.js
│   └── styles.css            # Dark theme
├── tests/
│   ├── define.test.ts
│   ├── record.test.ts
│   ├── query.test.ts
│   └── compare.test.ts
└── dist/                     # Build output
```

### Installation

```bash
# Build
cd codeshrike && npm install && npm run build

# Add to Claude Code
claude mcp add codeshrike -- node /path/to/codeshrike/dist/index.js

# Or via npx (once published)
claude mcp add codeshrike -- npx -y codeshrike@latest
```

### Integration with Agent Workflow

**Visual agent workflow with CodeShrike:**
```
1. Receive task: "Test login flow"
2. shrike_query(suite_id="login-flow") → check if suite exists
3. If not: shrike_define(suite_id="login-flow", steps=[...], layers=["ui","api","auth"])
4. For each step:
   a. Perform browser action via chrome-devtools-mcp
   b. take_screenshot(filePath="/tmp/codeshrike/login-flow/step-id.png")
   c. shrike_record(suite_id="login-flow", results=[{step_id, status, screenshot_path, actual}])
5. Final shrike_record with _complete=true
6. Return structured report referencing suite_id and run_id
```

**Orchestrator workflow with CodeShrike:**
```
1. Before dispatching visual/tester: shrike_query() to see existing suites
2. After verification phase: shrike_query(status_filter="failing_suites")
3. If gaps found: dispatch additional agents to fill them
4. shrike_dashboard() for human review
```
