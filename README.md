# CodeShrike

```
  ██████╗ ██████╗ ██████╗ ███████╗███████╗██╗  ██╗██████╗ ██╗██╗  ██╗███████╗
 ██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔════╝██║  ██║██╔══██╗██║██║ ██╔╝██╔════╝
 ██║     ██║   ██║██║  ██║█████╗  ███████╗███████║██████╔╝██║█████╔╝ █████╗
 ██║     ██║   ██║██║  ██║██╔══╝  ╚════██║██╔══██║██╔══██╗██║██╔═██╗ ██╔══╝
 ╚██████╗╚██████╔╝██████╔╝███████╗███████║██║  ██║██║  ██║██║██║  ██╗███████╗
  ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝╚══════╝
```

**Pin every result. Miss nothing.**

CodeShrike is an MCP (Model Context Protocol) server that gives AI agents a persistent, organized test suite library. Agents create test suites with named steps, record results with screenshots, query coverage gaps, and compare runs across sessions. A built-in web dashboard lets humans verify that agents tested the right things at the right depth.

> Part of the **CodeGiraffe** brand family: [CodeGiraffe](https://github.com/jthom233/CodeGiraffe) (architecture) → [CodeLynx](https://github.com/jthom233/CodeLynx) (code intelligence) → **CodeShrike** (test management)

---

## The Problem

AI agents claim tests pass when they haven't tested the full scope.

**Example:** You ask an agent to test file share permissions. The agent tests the UI components (checkboxes render, the form submits) and reports `PASS` — but never tests actual filesystem enforcement: can a read-only user actually write files? You have no way to know what was actually tested.

**Root causes:**
- No persistent test library — every session starts from scratch
- No organized test steps — agents produce free-form reports
- No scope coverage visibility — humans can't see testing depth
- No screenshot-to-step matching — evidence is scattered
- Test knowledge doesn't accumulate across sessions

CodeShrike solves all of these.

---

## Quick Start

### Install

```bash
git clone https://github.com/jthom233/CodeShrike
cd CodeShrike
npm install
npm run build
```

### Add to Claude Code

```bash
# From local build
claude mcp add codeshrike -- node /path/to/codeshrike/dist/index.js

# With custom project path (stores DB and screenshots here)
claude mcp add codeshrike -- node /path/to/codeshrike/dist/index.js --project-path /path/to/your/project
```

### Verify It's Running

In a Claude Code session:

```
Use shrike_query to list all test suites.
```

Claude will call `shrike_query` and return an empty suite list — CodeShrike is ready.

---

## How It Works

CodeShrike uses a **two-process model** to separate test management from the dashboard UI.

```
Claude Code (AI agent)
    │
    ├─── stdio ──► MCP Server (Process 1)
    │                  │
    │                  ├── Reads/writes SQLite (WAL mode)
    │                  ├── Copies screenshots to managed storage
    │                  └── Spawns on demand ──► Dashboard HTTP Server (Process 2)
    │                                               │
    │                                               ├── Express on localhost:8420
    │                                               ├── Reads SQLite (read-only)
    │                                               └── Serves screenshots + SPA
    │
    └─── stdio ──► chrome-devtools-mcp (browser automation)
```

**Process 1 — MCP Server:** Receives all tool calls via stdio. The sole writer to the SQLite database. Manages screenshot storage. Runs an auto-close timer that seals abandoned runs after 10 minutes of inactivity.

**Process 2 — Dashboard:** Spawned on demand when an agent calls `shrike_dashboard`. A detached Express HTTP server that serves the web dashboard SPA and all API routes. Read-only access to SQLite via WAL mode (safe concurrent access). Killed when the MCP server exits.

See [docs/architecture.md](docs/architecture.md) for full detail.

---

## Tool Reference

CodeShrike exposes 5 MCP tools. All tool calls accept and return JSON.

### `shrike_define`

Create or update a test suite. Idempotent by `suite_id` — calling it again with the same ID updates the suite and bumps its version. **Replacing a suite's steps deletes all prior step results for that suite.**

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suite_id` | string | yes | Kebab-case identifier, e.g. `"login-flow"` |
| `name` | string | yes | Human-readable suite name |
| `description` | string | no | Optional longer description |
| `layers` | string[] | yes | Scope layers this suite intends to cover |
| `steps` | Step[] | yes | Ordered test steps (see below) |

**Step object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | string | yes | Kebab-case step identifier, e.g. `"submit-login-form"` |
| `name` | string | yes | Verification-level description |
| `layer` | string | yes | One of the 8 scope layers |
| `expected` | string | yes | What success looks like |

**Returns:** `{ suite_id, version, step_count, step_ids[] }`

**Example:**

```json
{
  "suite_id": "login-flow",
  "name": "Login Flow",
  "description": "End-to-end login: UI rendering, API auth, session creation",
  "layers": ["ui", "api", "auth"],
  "steps": [
    {
      "step_id": "login-form-renders",
      "name": "Login form renders correctly",
      "layer": "ui",
      "expected": "Email field, password field, and submit button visible"
    },
    {
      "step_id": "submit-valid-credentials",
      "name": "POST /api/auth/login returns 200 with token",
      "layer": "api",
      "expected": "Response contains { token, user_id, expires_at }"
    },
    {
      "step_id": "session-cookie-set",
      "name": "Session cookie written after successful login",
      "layer": "auth",
      "expected": "HttpOnly cookie 'session' present with correct domain and expiry"
    }
  ]
}
```

Response:

```json
{
  "suite_id": "login-flow",
  "version": 1,
  "step_count": 3,
  "step_ids": ["login-form-renders", "submit-valid-credentials", "session-cookie-set"]
}
```

---

### `shrike_record`

Record results for one or more steps. Auto-creates a run if no active run exists for the suite. Auto-closes after 10 minutes of inactivity (configurable). Call with `_complete: true` to explicitly close the run.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suite_id` | string | yes | Suite to record results for |
| `run_label` | string | no | Human-readable label for this run, e.g. `"PR #124 pre-merge"` |
| `results` | Result[] | yes | Array of step results |
| `_complete` | boolean | no | If `true`, closes the run after recording |

**Result object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | string | yes | Step to record |
| `status` | `"pass"` \| `"fail"` \| `"skip"` \| `"blocked"` | yes | Result status |
| `actual` | string | no | What actually happened (required on `fail`) |
| `screenshot_path` | string | no | Absolute path to a screenshot file; CodeShrike copies it to managed storage |
| `notes` | string | no | Free-form notes |

**Returns:** `{ run_id, recorded, run_progress, remaining_steps[] }`

**Example:**

```json
{
  "suite_id": "login-flow",
  "run_label": "v2.4.1 release candidate",
  "results": [
    {
      "step_id": "login-form-renders",
      "status": "pass",
      "screenshot_path": "/tmp/screenshots/login-form.png",
      "actual": "All three fields visible, submit button enabled"
    },
    {
      "step_id": "submit-valid-credentials",
      "status": "fail",
      "actual": "API returned 401 Unauthorized — token missing from response body",
      "notes": "Regression introduced in auth middleware refactor"
    }
  ]
}
```

Response:

```json
{
  "run_id": "run_aB3kX9mNpQ4r",
  "recorded": 2,
  "run_progress": {
    "total": 3,
    "passed": 1,
    "failed": 1,
    "skipped": 0,
    "blocked": 0,
    "untested": 1
  },
  "remaining_steps": [
    {
      "step_id": "session-cookie-set",
      "name": "Session cookie written after successful login",
      "layer": "auth"
    }
  ]
}
```

---

### `shrike_query`

Retrieve suites, runs, and results. Operates in three modes depending on which parameters you provide.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suite_id` | string | no | Filter to a specific suite |
| `run_id` | string | no | Retrieve a specific run with all step results |
| `status_filter` | string | no | See status filters below |
| `include_steps` | boolean | no | Include step definitions in response (default: `true` for single suite, `false` for list) |
| `limit` | integer | no | Max runs to return per suite (default: `1`) |

**Status filters:**

| Value | Description |
|-------|-------------|
| `all` | No filter (default) |
| `pass` | Steps/runs with passing results only |
| `fail` | Steps/runs with failing results only |
| `skip` | Skipped steps only |
| `blocked` | Blocked steps only |
| `untested` | Steps with no recorded result |
| `failing_suites` | Suites where the latest run has at least one failure |

**Modes:**

- **No parameters** — List all suites with latest run summary
- **`suite_id` only** — Suite detail with steps and recent runs
- **`run_id`** — Full run detail with all step results

**Example — list all suites:**

```json
{}
```

Response:

```json
{
  "suites": [
    {
      "id": "login-flow",
      "name": "Login Flow",
      "layers": ["ui", "api", "auth"],
      "step_count": 3,
      "version": 1,
      "latest_run": {
        "id": "run_aB3kX9mNpQ4r",
        "label": "v2.4.1 release candidate",
        "status": "completed",
        "started_at": "2025-08-12T14:32:01",
        "summary": { "total": 3, "passed": 2, "failed": 1, "skipped": 0, "blocked": 0, "untested": 0 }
      }
    }
  ]
}
```

**Example — get failing suites only:**

```json
{ "status_filter": "failing_suites" }
```

---

### `shrike_compare`

Compare two runs of the same suite. Defaults to the most recent two runs. Classifies each step as a regression, improvement, persistent failure, or unchanged pass.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suite_id` | string | yes | Suite to compare runs for |
| `run_id_a` | string | no | Older run (baseline). Defaults to second-most-recent. |
| `run_id_b` | string | no | Newer run (current). Defaults to most recent. |

> Provide both `run_id_a` and `run_id_b`, or neither. Providing only one is an error.

**Returns:** Classified step lists and a summary.

**Example:**

```json
{ "suite_id": "login-flow" }
```

Response:

```json
{
  "suite_id": "login-flow",
  "run_a": { "id": "run_prev", "label": "v2.4.0", "started_at": "2025-08-11T10:00:00" },
  "run_b": { "id": "run_aB3kX9mNpQ4r", "label": "v2.4.1 release candidate", "started_at": "2025-08-12T14:32:01" },
  "regressions": [
    {
      "step_id": "submit-valid-credentials",
      "step_name": "POST /api/auth/login returns 200 with token",
      "layer": "api",
      "status_a": "pass",
      "status_b": "fail",
      "screenshot_a": "screenshots/login-flow/run_prev/01-submit-valid-credentials.png",
      "screenshot_b": "screenshots/login-flow/run_aB3kX9mNpQ4r/01-submit-valid-credentials.png"
    }
  ],
  "improvements": [],
  "persistent_failures": [],
  "unchanged_passes": [
    { "step_id": "login-form-renders", "step_name": "Login form renders correctly", "layer": "ui", "status_a": "pass", "status_b": "pass", "screenshot_a": null, "screenshot_b": null }
  ],
  "new_steps": [],
  "removed_steps": [],
  "other_changes": [],
  "summary": {
    "total_steps": 3,
    "regressions": 1,
    "improvements": 0,
    "persistent_failures": 0,
    "unchanged_passes": 1
  }
}
```

---

### `shrike_dashboard`

Spawn the web dashboard as a background HTTP server. Returns immediately with the URL. If already running, returns the existing URL.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `port` | integer | no | Port to serve on (default: `8420`) |

**Returns:** `{ status, url, pid }`

**Example:**

```json
{ "port": 8420 }
```

Response:

```json
{
  "status": "started",
  "url": "http://localhost:8420",
  "pid": 14382
}
```

If already running:

```json
{
  "status": "already_running",
  "url": "http://localhost:8420",
  "pid": 14382
}
```

---

## Scope Layers

Every test step is tagged with one of 8 scope layers. This forces explicit coverage decisions and makes gaps visible.

| Layer | What it tests |
|-------|---------------|
| `ui` | Visual rendering, layout, user interaction in the browser |
| `api` | HTTP endpoints — request/response contracts, status codes, payloads |
| `logic` | Business rules, computation, state transitions, pure functions |
| `data` | Database reads/writes, schema integrity, query correctness |
| `filesystem` | File creation/deletion/permissions, directory structure |
| `auth` | Authentication, authorization, session management, token validation |
| `integration` | Cross-service calls, message queues, third-party APIs |
| `performance` | Response times, throughput, resource consumption under load |

See [docs/scope-layers.md](docs/scope-layers.md) for detailed guidance on each layer.

---

## Dashboard

Open the dashboard by calling `shrike_dashboard` in any Claude Code session, then visit `http://localhost:8420`.

### Views

**Suite Library** — A table of all test suites with scope layer badges (green = step present, red = gap), health status, and latest run summary. Click any suite to drill in.

**Suite Detail** — Step list grouped by scope layer, coverage summary (intended vs actual layers), and run history. Links to individual runs.

**Run Detail** — Step navigator strip showing pass/fail/skip/blocked status at a glance. Click any step to see expected outcome, actual outcome, notes, and screenshot. Navigate with keyboard shortcuts.

**Coverage Matrix** — A suites × layers grid. Each cell shows the step count for that layer in that suite. Red = zero steps for an intended layer (coverage gap). Color-coded health column: OK / GAP / SHALLOW / EMPTY.

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate down / up |
| `Enter` | Open selected item |
| `←` / `→` | Previous / next step (in Run Detail) |
| `/` | Focus filter input |
| `Tab` | Switch views |
| `?` | Show shortcuts help |

See [docs/dashboard.md](docs/dashboard.md) for API endpoint reference.

---

## Storage

All data is stored under a `.codeshrike/` directory in your project root (or the `--project-path` you configure).

```
{project}/.codeshrike/
├── db.sqlite              # SQLite database
├── db.sqlite-wal          # WAL journal (auto-managed)
├── db.sqlite-shm          # Shared memory map (auto-managed)
├── screenshots/
│   └── {suite_id}/
│       └── {run_id}/
│           └── {step_ordinal}-{step_id}.png
└── .gitignore             # Auto-created: ignores all .codeshrike contents
```

Screenshots are copied from wherever the agent captures them (e.g. `/tmp/`) into managed storage. The naming convention (`{ordinal}-{step_id}.png`) keeps them ordered and human-readable.

The database uses 4 tables: `suites`, `steps`, `runs`, `step_results`. See [docs/architecture.md](docs/architecture.md) for the full schema.

---

## Configuration

### `--project-path`

Where CodeShrike stores its database and screenshots. Defaults to `process.cwd()`.

```bash
node dist/index.js --project-path /path/to/project
```

When you `claude mcp add`, pass it as an argument:

```bash
claude mcp add codeshrike -- node /path/to/codeshrike/dist/index.js --project-path /path/to/project
```

### `--port` (dashboard)

The dashboard port is specified per-call via the `shrike_dashboard` tool's `port` parameter (default `8420`). There is no static server — the dashboard is spawned on demand.

---

## Testing

```bash
# Run all tests once
npm test

# Run in watch mode
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/) and create isolated temporary directories for each test case — no shared state, no database cleanup boilerplate. Test files mirror the source structure:

```
tests/
├── helpers.ts          # createTestDir(), cleanTestDir(), parseResult()
├── define.test.ts      # shrike_define unit tests
├── record.test.ts      # shrike_record unit tests
├── query.test.ts       # shrike_query unit tests
├── compare.test.ts     # shrike_compare unit tests
└── integration.test.ts # Cross-tool workflow tests
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes with tests
4. Run the test suite: `npm test`
5. Open a pull request

Please follow existing code style (TypeScript strict mode, ESM modules, no build-step dashboard). All new tools or API routes should have corresponding tests.

---

## License

MIT — see [LICENSE](LICENSE).

---

## Brand Family

| Tool | Role |
|------|------|
| [CodeGiraffe](https://github.com/jthom233/CodeGiraffe) | Architecture graph — understand what connects to what |
| [CodeLynx](https://github.com/jthom233/CodeLynx) | Code intelligence — read, navigate, and edit symbols |
| **CodeShrike** | Test management — pin every result, miss nothing |

All three are MCP servers designed to give AI agents the same situational awareness that experienced human engineers have.
