# CodeShrike — Dashboard

The CodeShrike dashboard is a web application for humans to review what AI agents tested, at what scope depth, and with what evidence. It is read-only — it displays data recorded by agents, it does not create or modify test data.

Related: [Architecture](architecture.md) | [Tool Reference](tools.md)

---

## Accessing the Dashboard

From any Claude Code session where CodeShrike is configured:

```
Start the CodeShrike dashboard.
```

Claude will call `shrike_dashboard`, which spawns the Express server and returns the URL. Open `http://localhost:8420` in your browser.

Alternatively, call the tool directly:

```json
{ "tool": "shrike_dashboard", "arguments": { "port": 8420 } }
```

The dashboard process is kept alive as long as the MCP server is running. If you restart Claude Code, call `shrike_dashboard` again to restart the dashboard.

---

## Views

### Suite Library

The default landing view. Shows all test suites in a table.

**Columns:**

| Column | Description |
|--------|-------------|
| Suite | Suite name and ID |
| Layers | Scope layer badges — green if the suite has steps for that layer, red if it's in `layers` but has no steps (gap), grey if not claimed |
| Steps | Total step count |
| Last Run | Most recent run label, date, and status |
| Health | PASS / FAIL / GAP / SHALLOW / EMPTY |

**Health badges:**

| Badge | Meaning |
|-------|---------|
| PASS | Latest run has no failures |
| FAIL | Latest run has at least one failure |
| GAP | Suite claims a layer but has no steps for it |
| SHALLOW | Suite has steps in 2 or fewer layers |
| EMPTY | Suite has no steps at all |

**Filtering:** Press `/` to focus the filter input. Type to filter suites by name.

**Navigation:** Use `j`/`k` to move up/down, `Enter` to open the selected suite.

---

### Suite Detail

Opened by clicking a suite in the Suite Library.

**Sections:**

**Header:** Suite name, ID, version, description (if set).

**Scope Coverage:** A mini coverage summary showing intended vs actual layers. Gaps (layers declared in `layers` but with no steps) are highlighted in red.

```
Intended:  ui  api  logic  data  auth
Actual:    ui  api  logic  data
Gaps:                             auth  ← no steps cover this layer
```

**Steps List:** All steps in ordinal order. Each row shows:
- Step name
- Layer badge (color-coded)
- Expected outcome
- Status from the latest run (if any)

**Run History:** A table of recent runs (up to 10) with status, label, start time, and summary counts. Click any run to open Run Detail.

---

### Run Detail

Opened by clicking a run in Suite Detail or from the Run History table.

**Step Navigator Strip:** A horizontal strip of colored squares across the top — one per step, in ordinal order. Color codes:

| Color | Status |
|-------|--------|
| Green | pass |
| Red | fail |
| Yellow | skip |
| Orange | blocked |
| Grey | untested |

Click any square to jump to that step. Use `←`/`→` to navigate sequentially.

**Step Panel:** The main content area. For the selected step:

- **Step name** and layer badge
- **Expected outcome** — what success was supposed to look like
- **Actual outcome** — what the agent observed (if recorded)
- **Status badge** — pass / fail / skip / blocked
- **Notes** — any free-form notes from the agent
- **Screenshot** — the screenshot image if one was captured (see below)

**Run Summary:** In the sidebar: run label, status, started/finished times, and progress bar (passed / failed / skipped / blocked / untested).

---

### Coverage Matrix

Accessed via the Tab key or the navigation header. Shows a grid of all suites (rows) × all 8 scope layers (columns).

**Cells:** Each cell shows the number of steps the suite has in that layer. Zero = no coverage.

**Color coding:**
- **Green** — layer has steps and was intended to be covered
- **Red** — layer was intended (declared in `layers`) but has zero steps (gap)
- **Light grey** — layer was not declared, no steps (not a gap, just not in scope)
- **Dark grey** — layer not declared, but has steps anyway (unexpected coverage)

**Health column:** A per-suite health indicator at the right edge — OK / GAP / SHALLOW / EMPTY.

**Reading the matrix:** Scan vertically to see which suites cover a given layer. Scan horizontally to see how deep a suite's coverage is. Red cells are action items — either add steps to cover the gap, or remove the layer from `layers` if it was declared by mistake.

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j` | Navigate down (suites, steps, runs) |
| `k` | Navigate up |
| `Enter` | Open selected item |
| `←` | Previous step (Run Detail) |
| `→` | Next step (Run Detail) |
| `/` | Focus filter input |
| `Tab` | Cycle between views |
| `Escape` | Clear filter / close panel |
| `?` | Show keyboard shortcuts help overlay |

---

## API Endpoints

The dashboard exposes a REST API used by the SPA frontend. You can also call these endpoints directly from scripts or other tools.

All endpoints return JSON. Screenshots are served as static files (images).

### `GET /api/suites`

List all suites with latest run summary.

**Response:**

```json
{
  "suites": [
    {
      "id": "login-flow",
      "name": "Login Flow",
      "description": "End-to-end login testing",
      "layers": ["ui", "api", "auth"],
      "version": 1,
      "step_count": 3,
      "latest_run": {
        "id": "run_aB3kX9mNpQ4r",
        "label": "v2.4.1 RC",
        "status": "completed",
        "started_at": "2025-08-12T14:32:01",
        "finished_at": "2025-08-12T14:35:22",
        "summary": { "total": 3, "passed": 2, "failed": 1, "skipped": 0, "blocked": 0, "untested": 0 }
      }
    }
  ]
}
```

---

### `GET /api/suites/:id`

Suite detail: suite metadata, all steps, recent runs (up to 10), and scope coverage.

**Example:** `GET /api/suites/login-flow`

**Response:**

```json
{
  "suite": {
    "id": "login-flow",
    "name": "Login Flow",
    "layers": ["ui", "api", "auth"],
    "version": 1,
    "created_at": "2025-08-10T09:00:00",
    "updated_at": "2025-08-10T09:00:00"
  },
  "steps": [
    { "id": "login-form-renders", "suite_id": "login-flow", "ordinal": 0, "name": "Login form renders correctly", "layer": "ui", "expected": "Email field, password field, and submit button visible" },
    { "id": "submit-valid-credentials", "suite_id": "login-flow", "ordinal": 1, "name": "POST /api/auth/login returns 200", "layer": "api", "expected": "Response contains token and user_id" },
    { "id": "session-cookie-set", "suite_id": "login-flow", "ordinal": 2, "name": "Session cookie written", "layer": "auth", "expected": "HttpOnly session cookie present with correct domain" }
  ],
  "runs": [
    { "id": "run_aB3kX9mNpQ4r", "label": "v2.4.1 RC", "status": "completed", "started_at": "2025-08-12T14:32:01", "summary": { "total": 3, "passed": 2, "failed": 1, "skipped": 0, "blocked": 0, "untested": 0 } }
  ],
  "scope_coverage": {
    "intended": ["ui", "api", "auth"],
    "actual": ["ui", "api", "auth"],
    "gaps": []
  }
}
```

---

### `GET /api/suites/:id/runs`

Paginated run history for a suite.

**Query parameters:**

| Parameter | Default | Description |
|-----------|---------|-------------|
| `limit` | `20` | Maximum runs to return |

**Example:** `GET /api/suites/login-flow/runs?limit=5`

**Response:**

```json
{
  "runs": [
    { "id": "run_aB3kX9mNpQ4r", "label": "v2.4.1 RC", "status": "completed", "started_at": "2025-08-12T14:32:01", "summary": { ... } },
    { "id": "run_prevRun0001", "label": "v2.4.0 final", "status": "completed", "started_at": "2025-08-10T10:00:00", "summary": { ... } }
  ]
}
```

---

### `GET /api/runs/:id`

Full run detail: run metadata, all step results, all step definitions, untested steps, and progress counts.

**Example:** `GET /api/runs/run_aB3kX9mNpQ4r`

**Response:**

```json
{
  "run": {
    "id": "run_aB3kX9mNpQ4r",
    "suite_id": "login-flow",
    "suite_version": 1,
    "label": "v2.4.1 RC",
    "status": "completed",
    "started_at": "2025-08-12T14:32:01",
    "finished_at": "2025-08-12T14:35:22",
    "summary": { "total": 3, "passed": 2, "failed": 1, "skipped": 0, "blocked": 0, "untested": 0 }
  },
  "results": [
    {
      "id": "r4kXmN",
      "run_id": "run_aB3kX9mNpQ4r",
      "step_id": "login-form-renders",
      "status": "pass",
      "actual": "All three elements visible and styled correctly.",
      "notes": null,
      "screenshot": "screenshots/login-flow/run_aB3kX9mNpQ4r/00-login-form-renders.png",
      "recorded_at": "2025-08-12T14:32:30"
    },
    {
      "id": "m9bNpX",
      "run_id": "run_aB3kX9mNpQ4r",
      "step_id": "submit-valid-credentials",
      "status": "fail",
      "actual": "API returned 401. Token missing from response.",
      "notes": "Regression in auth middleware",
      "screenshot": null,
      "recorded_at": "2025-08-12T14:33:45"
    }
  ],
  "steps": [ ... ],
  "untested_steps": [],
  "progress": {
    "total": 3,
    "passed": 2,
    "failed": 1,
    "skipped": 0,
    "blocked": 0,
    "untested": 0
  }
}
```

---

### `GET /api/coverage`

Scope coverage matrix across all suites. Used by the Coverage Matrix view.

**Response:**

```json
{
  "layers": ["ui", "api", "logic", "data", "filesystem", "auth", "integration", "performance"],
  "suites": [
    {
      "suite_id": "login-flow",
      "name": "Login Flow",
      "layers": {
        "ui": 1,
        "api": 1,
        "logic": 0,
        "data": 0,
        "filesystem": 0,
        "auth": 1,
        "integration": 0,
        "performance": 0
      },
      "intended": ["ui", "api", "auth"],
      "gaps": [],
      "depth": 3,
      "health": "OK"
    }
  ]
}
```

**Health values:**

| Value | Condition |
|-------|-----------|
| `OK` | Steps in all intended layers, depth > 2 |
| `GAP` | At least one intended layer has no steps |
| `SHALLOW` | No gaps, but only 1–2 layers covered |
| `EMPTY` | No steps at all |

---

### `GET /api/compare/:a/:b`

Compare two run IDs. Both runs must belong to the same suite.

**Example:** `GET /api/compare/run_prevRun0001/run_aB3kX9mNpQ4r`

**Response:** Same schema as `shrike_compare` tool output (see [tools.md](tools.md#shrike_compare)).

**Error responses:**

- `404` — Either run ID not found
- `400` — Runs belong to different suites

---

### `GET /screenshots/*`

Serve screenshot files from `.codeshrike/screenshots/`.

**Example:** `GET /screenshots/login-flow/run_aB3kX9mNpQ4r/00-login-form-renders.png`

The path after `/screenshots/` maps directly to the filesystem at `{project_path}/.codeshrike/screenshots/`. Served as-is by Express static middleware.

Screenshot paths in API responses (the `screenshot` field on step results) use this format and can be constructed into full URLs by prepending `http://localhost:8420/`.

**Example:** If `step_result.screenshot` is `"screenshots/login-flow/run_aB3kX9mNpQ4r/00-login-form-renders.png"`, the full URL is:

```
http://localhost:8420/screenshots/login-flow/run_aB3kX9mNpQ4r/00-login-form-renders.png
```

---

## SPA Structure

The dashboard frontend is vanilla HTML/JS/CSS with no build step. Files live in `dashboard/` at the project root:

```
dashboard/
├── index.html           # SPA shell — loads styles.css and app.js
├── app.js               # Router, state management, keyboard handlers
├── styles.css           # Dark theme, layout
└── components/
    ├── suite-list.js    # Suite Library view
    ├── suite-detail.js  # Suite Detail view
    ├── run-viewer.js    # Run Detail view
    └── coverage-matrix.js  # Coverage Matrix view
```

The Express server (`dist/dashboard/server.js`) serves this directory as static files and falls back to `index.html` for all unmatched routes (SPA client-side routing).

At runtime, all API calls go to the same origin (`http://localhost:{port}/api/...`). There is no CORS configuration needed.
