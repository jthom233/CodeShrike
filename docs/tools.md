# CodeShrike — Tool Reference

Full parameter descriptions, return value schemas, example calls, and edge cases for all 5 MCP tools.

Related: [Architecture](architecture.md) | [Integration Guide](integration.md) | [Scope Layers](scope-layers.md)

---

## Overview

| Tool | Purpose |
|------|---------|
| [`shrike_define`](#shrike_define) | Create or update a test suite with named steps |
| [`shrike_record`](#shrike_record) | Record step results for a run |
| [`shrike_query`](#shrike_query) | Retrieve suites, runs, and results |
| [`shrike_compare`](#shrike_compare) | Compare two runs to find regressions |
| [`shrike_dashboard`](#shrike_dashboard) | Spawn the web dashboard |

All tools communicate over stdio using the MCP JSON-RPC protocol. Responses are always a single `content` array with one text item containing JSON.

---

## shrike_define

Create or update a test suite. Calling this with an existing `suite_id` **updates** the suite (bumps version, replaces all steps). Calling it with a new `suite_id` **creates** the suite.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `suite_id` | `string` | yes | — | Unique kebab-case identifier. Used as the primary key. Example: `"login-flow"`, `"file-permissions-suite"` |
| `name` | `string` | yes | — | Human-readable suite name shown in the dashboard |
| `description` | `string` | no | `null` | Optional longer description of what this suite tests |
| `layers` | `string[]` | yes | — | The scope layers this suite **intends** to cover. Used to compute coverage gaps. Must be a subset of the 8 valid layers. |
| `steps` | `Step[]` | yes | — | Ordered list of test steps. Order determines the `ordinal` value (0-indexed). |

### Step Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | `string` | yes | Kebab-case step identifier, unique within the suite. Example: `"submit-login-form"` |
| `name` | `string` | yes | Verification-level description. Should read as a testable assertion. |
| `layer` | `string` | yes | One of: `ui`, `api`, `logic`, `data`, `filesystem`, `auth`, `integration`, `performance` |
| `expected` | `string` | yes | What success looks like. Concrete and observable. |

### Return Value

```typescript
{
  suite_id: string;    // The suite_id you provided
  version: number;     // 1 on create, incremented on each update
  step_count: number;  // Total steps in the suite
  step_ids: string[];  // Step IDs in ordinal order
}
```

### Examples

**Create a new suite:**

```json
{
  "suite_id": "checkout-flow",
  "name": "Checkout Flow",
  "description": "Tests the complete e-commerce checkout: cart, payment, order confirmation",
  "layers": ["ui", "api", "logic", "data"],
  "steps": [
    {
      "step_id": "cart-renders-items",
      "name": "Cart page renders all added items",
      "layer": "ui",
      "expected": "Each item shows name, quantity, unit price, and subtotal. Total matches sum."
    },
    {
      "step_id": "apply-coupon-code",
      "name": "Valid coupon reduces order total",
      "layer": "logic",
      "expected": "10% discount applied. New total = original * 0.9. Discount line item shown."
    },
    {
      "step_id": "stripe-charge-endpoint",
      "name": "POST /api/checkout/charge calls Stripe with correct amount",
      "layer": "api",
      "expected": "Stripe API receives charge in cents matching order total. Returns charge ID."
    },
    {
      "step_id": "order-written-to-db",
      "name": "Successful payment creates order record",
      "layer": "data",
      "expected": "orders table has new row with correct user_id, total, status='paid', stripe_charge_id"
    }
  ]
}
```

Response:

```json
{
  "suite_id": "checkout-flow",
  "version": 1,
  "step_count": 4,
  "step_ids": ["cart-renders-items", "apply-coupon-code", "stripe-charge-endpoint", "order-written-to-db"]
}
```

**Update an existing suite (add a step):**

```json
{
  "suite_id": "checkout-flow",
  "name": "Checkout Flow",
  "layers": ["ui", "api", "logic", "data", "auth"],
  "steps": [
    { "step_id": "cart-renders-items", "name": "Cart page renders all added items", "layer": "ui", "expected": "Each item shows name, quantity, unit price, and subtotal." },
    { "step_id": "apply-coupon-code", "name": "Valid coupon reduces order total", "layer": "logic", "expected": "10% discount applied." },
    { "step_id": "stripe-charge-endpoint", "name": "POST /api/checkout/charge calls Stripe", "layer": "api", "expected": "Stripe API receives charge in cents." },
    { "step_id": "order-written-to-db", "name": "Successful payment creates order record", "layer": "data", "expected": "orders table has new row." },
    { "step_id": "guest-checkout-no-auth", "name": "Guest checkout does not require auth token", "layer": "auth", "expected": "POST /api/checkout/charge succeeds without Authorization header for guest sessions." }
  ]
}
```

Response:

```json
{
  "suite_id": "checkout-flow",
  "version": 2,
  "step_count": 5,
  "step_ids": ["cart-renders-items", "apply-coupon-code", "stripe-charge-endpoint", "order-written-to-db", "guest-checkout-no-auth"]
}
```

### Edge Cases

**Invalid layer value:**

If any step has a `layer` not in the valid set, the entire call is rejected before touching the database:

```json
{ "error": "Invalid layer values: step \"my-step\" has invalid layer \"network\". Valid layers: ui, api, logic, data, filesystem, auth, integration, performance" }
```

**Empty step list:**

Allowed. Creates a suite with zero steps. Useful for declaring intent before writing the steps.

**Replacing steps clears prior results:**

When `shrike_define` updates an existing suite, it replaces all steps atomically (within a SQLite transaction). All `step_results` that referenced the old steps are deleted. This prevents dangling result data for steps that no longer exist. Runs that were recorded against the old suite version remain in the `runs` table but their step results are gone.

**Idempotency:**

Calling `shrike_define` twice with identical arguments increments the version on the second call (from 1 to 2). There is no deep-equality check. If you want a stable version, only call `shrike_define` when the suite definition has actually changed.

---

## shrike_record

Record results for one or more steps. Auto-creates a run on the first call. Can be called multiple times for the same run (batch or step-by-step). Close the run with `_complete: true` or let it auto-close after 10 minutes.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `suite_id` | `string` | yes | — | Suite to record results for |
| `run_label` | `string` | no | `null` | Human-readable label shown in the dashboard. Examples: `"PR #124 pre-merge"`, `"nightly-2025-08-12"` |
| `results` | `Result[]` | yes | — | Array of step results. Can be any subset of the suite's steps. |
| `_complete` | `boolean` | no | `false` | If `true`, closes the run after recording. Sets `status = 'completed'` and computes the final summary. |

### Result Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `step_id` | `string` | yes | The step to record a result for |
| `status` | `"pass" \| "fail" \| "skip" \| "blocked"` | yes | Result status |
| `actual` | `string` | no | What actually happened. Highly recommended on `fail`. |
| `screenshot_path` | `string` | no | **Absolute path** to a screenshot file. CodeShrike copies it into managed storage. The original file is not modified. |
| `notes` | `string` | no | Free-form notes — investigation findings, workarounds, links to issues |

### Return Value

```typescript
{
  run_id: string;          // The run ID (consistent across calls for the same run)
  recorded: number;        // Count of results in this call (not total run count)
  run_progress: {
    total: number;         // Total steps in the suite
    passed: number;
    failed: number;
    skipped: number;
    blocked: number;
    untested: number;      // Steps with no result yet in this run
  };
  remaining_steps: Array<{
    step_id: string;
    name: string;
    layer: string;
  }>;                      // Steps not yet recorded in this run
}
```

### Examples

**Record a batch of results:**

```json
{
  "suite_id": "checkout-flow",
  "run_label": "v3.2.0 smoke test",
  "results": [
    {
      "step_id": "cart-renders-items",
      "status": "pass",
      "screenshot_path": "/tmp/cs-screenshots/cart-page.png",
      "actual": "4 items displayed with correct prices. Total shows $47.96."
    },
    {
      "step_id": "apply-coupon-code",
      "status": "fail",
      "actual": "Coupon SAVE10 applied but total reduced by 10 cents, not 10%. Bug in discount calculation.",
      "notes": "Regression from commit a3f9b12 — discount applied to cents instead of dollars"
    },
    {
      "step_id": "stripe-charge-endpoint",
      "status": "blocked",
      "notes": "Cannot test payment because coupon calculation is broken — total is wrong"
    }
  ]
}
```

Response:

```json
{
  "run_id": "run_pQ7mN3kXbL9w",
  "recorded": 3,
  "run_progress": {
    "total": 4,
    "passed": 1,
    "failed": 1,
    "skipped": 0,
    "blocked": 1,
    "untested": 1
  },
  "remaining_steps": [
    {
      "step_id": "order-written-to-db",
      "name": "Successful payment creates order record",
      "layer": "data"
    }
  ]
}
```

**Continue the same run and close it:**

```json
{
  "suite_id": "checkout-flow",
  "results": [
    {
      "step_id": "order-written-to-db",
      "status": "skip",
      "notes": "Skipped — upstream payment step is blocked"
    }
  ],
  "_complete": true
}
```

Response:

```json
{
  "run_id": "run_pQ7mN3kXbL9w",
  "recorded": 1,
  "run_progress": {
    "total": 4,
    "passed": 1,
    "failed": 1,
    "skipped": 1,
    "blocked": 1,
    "untested": 0
  },
  "remaining_steps": []
}
```

### Edge Cases

**Unknown step_id:** If a `step_id` in the results array does not exist in the suite, that result is silently skipped with a warning logged to stderr. The rest of the batch is still recorded. This allows partial calls when a step has been removed since the suite was last queried.

**Duplicate step result:** Calling `shrike_record` twice with the same `step_id` in the same run replaces the earlier result (SQLite `INSERT OR REPLACE`). The most recent call wins.

**Run label ignored after first call:** The `run_label` is set when the run is auto-created (first `shrike_record` call for that suite). Subsequent calls with a different `run_label` do not update the label.

**Missing screenshot file:** If `screenshot_path` points to a file that does not exist, the screenshot is silently skipped. The step result is still recorded. A warning is logged to stderr.

**Calling after `_complete`:** Once a run is marked `completed`, calling `shrike_record` on the same suite will auto-create a **new** run. There is no way to re-open a completed run.

---

## shrike_query

Retrieve suites, runs, and results with flexible filtering. Operates in three distinct modes based on the parameters provided.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `suite_id` | `string` | no | — | Filter to a specific suite |
| `run_id` | `string` | no | — | Retrieve a specific run with all results |
| `status_filter` | `StatusFilter` | no | `"all"` | Filter results by status (see below) |
| `include_steps` | `boolean` | no | `true` for single suite, `false` for list | Include step definitions in response |
| `limit` | `integer` | no | `1` | Maximum number of runs to return per suite |

### Status Filters

| Value | Behavior |
|-------|----------|
| `all` | No filter. Returns everything. |
| `pass` | Only steps/results with status `pass` |
| `fail` | Only steps/results with status `fail` |
| `skip` | Only steps/results with status `skip` |
| `blocked` | Only steps/results with status `blocked` |
| `untested` | Steps with no recorded result in the run. Returns `untested_steps` array; `results` array is empty. |
| `failing_suites` | (List mode only) Suites where the latest run has `summary.failed > 0` |

### Mode 1: List All Suites

Called with no `suite_id` and no `run_id`.

```json
{}
```

Returns a list of all suites, each with:
- Suite metadata (id, name, description, layers, version)
- `step_count` — total steps in the suite
- `latest_run` — most recent run with its summary (or `null` if never run)

**With `failing_suites` filter:**

```json
{ "status_filter": "failing_suites" }
```

Returns only suites where `latest_run.summary.failed > 0`.

**Full list response:**

```json
{
  "suites": [
    {
      "id": "checkout-flow",
      "name": "Checkout Flow",
      "description": "Tests the complete e-commerce checkout",
      "layers": ["ui", "api", "logic", "data"],
      "version": 2,
      "created_at": "2025-08-10T09:00:00",
      "updated_at": "2025-08-11T14:22:00",
      "step_count": 4,
      "latest_run": {
        "id": "run_pQ7mN3kXbL9w",
        "label": "v3.2.0 smoke test",
        "status": "completed",
        "started_at": "2025-08-12T08:30:00",
        "finished_at": "2025-08-12T08:35:00",
        "summary": {
          "total": 4,
          "passed": 1,
          "failed": 1,
          "skipped": 1,
          "blocked": 1,
          "untested": 0
        }
      }
    }
  ]
}
```

### Mode 2: Suite Detail

Called with `suite_id` but without `run_id`.

```json
{ "suite_id": "checkout-flow", "limit": 3 }
```

Returns:
- Full suite object (with `layers` parsed from JSON string to array)
- `steps` — all step definitions in ordinal order
- `runs` — up to `limit` most recent runs with summaries
- `scope_coverage` — coverage analysis (intended vs actual layers, gaps)

**Full suite detail response:**

```json
{
  "suite": {
    "id": "checkout-flow",
    "name": "Checkout Flow",
    "layers": ["ui", "api", "logic", "data"],
    "version": 2,
    "created_at": "2025-08-10T09:00:00",
    "updated_at": "2025-08-11T14:22:00"
  },
  "steps": [
    { "id": "cart-renders-items", "suite_id": "checkout-flow", "ordinal": 0, "name": "Cart page renders all added items", "layer": "ui", "expected": "Each item shows name, quantity, unit price, and subtotal." },
    { "id": "apply-coupon-code", "suite_id": "checkout-flow", "ordinal": 1, "name": "Valid coupon reduces order total", "layer": "logic", "expected": "10% discount applied." },
    { "id": "stripe-charge-endpoint", "suite_id": "checkout-flow", "ordinal": 2, "name": "POST /api/checkout/charge calls Stripe", "layer": "api", "expected": "Stripe API receives charge in cents." },
    { "id": "order-written-to-db", "suite_id": "checkout-flow", "ordinal": 3, "name": "Successful payment creates order record", "layer": "data", "expected": "orders table has new row." }
  ],
  "runs": [
    {
      "id": "run_pQ7mN3kXbL9w",
      "label": "v3.2.0 smoke test",
      "status": "completed",
      "started_at": "2025-08-12T08:30:00",
      "summary": { "total": 4, "passed": 1, "failed": 1, "skipped": 1, "blocked": 1, "untested": 0 }
    }
  ],
  "scope_coverage": {
    "intended": ["ui", "api", "logic", "data"],
    "actual": ["ui", "logic", "api", "data"],
    "gaps": []
  }
}
```

A `gaps` array with items means the suite declared it would cover those layers but has no steps for them. This is a suite design problem, not a test execution problem.

### Mode 3: Run Detail

Called with `run_id`.

```json
{ "run_id": "run_pQ7mN3kXbL9w" }
```

Returns full run data including all step results, steps, untested steps, and progress counts.

**Full run detail response:**

```json
{
  "run": {
    "id": "run_pQ7mN3kXbL9w",
    "suite_id": "checkout-flow",
    "suite_version": 2,
    "label": "v3.2.0 smoke test",
    "status": "completed",
    "started_at": "2025-08-12T08:30:00",
    "finished_at": "2025-08-12T08:35:00",
    "summary": { "total": 4, "passed": 1, "failed": 1, "skipped": 1, "blocked": 1, "untested": 0 }
  },
  "results": [
    {
      "id": "r4kXmN",
      "run_id": "run_pQ7mN3kXbL9w",
      "step_id": "cart-renders-items",
      "status": "pass",
      "actual": "4 items displayed with correct prices.",
      "notes": null,
      "screenshot": "screenshots/checkout-flow/run_pQ7mN3kXbL9w/00-cart-renders-items.png",
      "recorded_at": "2025-08-12T08:31:00"
    },
    {
      "id": "m9bNpX",
      "run_id": "run_pQ7mN3kXbL9w",
      "step_id": "apply-coupon-code",
      "status": "fail",
      "actual": "Coupon applied but discount is $0.10 instead of $4.80.",
      "notes": "Regression from commit a3f9b12",
      "screenshot": null,
      "recorded_at": "2025-08-12T08:32:15"
    }
  ],
  "steps": [ ... ],
  "untested_steps": [],
  "progress": {
    "total": 4,
    "passed": 1,
    "failed": 1,
    "skipped": 1,
    "blocked": 1,
    "untested": 0
  }
}
```

**With status filter:**

```json
{ "run_id": "run_pQ7mN3kXbL9w", "status_filter": "fail" }
```

Returns only failed step results. Other fields (`steps`, `progress`, `untested_steps`) are unaffected.

### Edge Cases

**Suite not found:** Returns `{ "error": "Suite not found: checkout-flow-typo" }`.

**Run not found:** Returns `{ "error": "Run not found: run_badid" }`.

**`limit` default is 1:** When listing all suites, only the most recent run is returned per suite by default. Pass `limit: 10` to see more run history.

**`status_filter: "failing_suites"` in run detail mode:** This filter is only meaningful in list mode (no `suite_id`, no `run_id`). In run detail mode it has no effect.

---

## shrike_compare

Compare two runs of the same suite. Classifies each step into one of several categories based on how its status changed between runs.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `suite_id` | `string` | yes | Suite whose runs to compare |
| `run_id_a` | `string` | no | Older run (baseline). Defaults to the second-most-recent run. |
| `run_id_b` | `string` | no | Newer run (current). Defaults to the most recent run. |

> Provide both `run_id_a` and `run_id_b`, or neither. Providing only one returns an error.

### Return Value

```typescript
{
  suite_id: string;
  run_a: { id: string; label: string | null; started_at: string };
  run_b: { id: string; label: string | null; started_at: string };
  regressions: ClassifiedStep[];         // pass in A → fail in B
  improvements: ClassifiedStep[];        // fail in A → pass in B
  persistent_failures: ClassifiedStep[]; // fail in A → fail in B
  unchanged_passes: ClassifiedStep[];    // pass in A → pass in B
  new_steps: ClassifiedStep[];           // no result in A, result in B
  removed_steps: ClassifiedStep[];       // result in A, no result in B
  other_changes: ClassifiedStep[];       // any other status transition
  summary: {
    total_steps: number;
    regressions: number;
    improvements: number;
    persistent_failures: number;
    unchanged_passes: number;
  };
}
```

### ClassifiedStep Object

```typescript
{
  step_id: string;
  step_name: string;
  layer: string;
  status_a: string | null;   // null if no result in run A
  status_b: string | null;   // null if no result in run B
  screenshot_a: string | null;
  screenshot_b: string | null;
}
```

### Examples

**Auto-compare last two runs:**

```json
{ "suite_id": "login-flow" }
```

**Compare specific runs:**

```json
{
  "suite_id": "login-flow",
  "run_id_a": "run_beforeRefactor",
  "run_id_b": "run_afterRefactor"
}
```

**Full response:**

```json
{
  "suite_id": "login-flow",
  "run_a": { "id": "run_beforeRefactor", "label": "v2.3.0", "started_at": "2025-08-10T10:00:00" },
  "run_b": { "id": "run_afterRefactor", "label": "v2.4.0", "started_at": "2025-08-12T14:30:00" },
  "regressions": [
    {
      "step_id": "submit-valid-credentials",
      "step_name": "POST /api/auth/login returns 200 with token",
      "layer": "api",
      "status_a": "pass",
      "status_b": "fail",
      "screenshot_a": "screenshots/login-flow/run_beforeRefactor/01-submit-valid-credentials.png",
      "screenshot_b": null
    }
  ],
  "improvements": [
    {
      "step_id": "password-reset-email",
      "step_name": "Password reset email sent within 5 seconds",
      "layer": "integration",
      "status_a": "fail",
      "status_b": "pass",
      "screenshot_a": null,
      "screenshot_b": null
    }
  ],
  "persistent_failures": [],
  "unchanged_passes": [
    {
      "step_id": "login-form-renders",
      "step_name": "Login form renders correctly",
      "layer": "ui",
      "status_a": "pass",
      "status_b": "pass",
      "screenshot_a": "screenshots/login-flow/run_beforeRefactor/00-login-form-renders.png",
      "screenshot_b": "screenshots/login-flow/run_afterRefactor/00-login-form-renders.png"
    }
  ],
  "new_steps": [],
  "removed_steps": [],
  "other_changes": [],
  "summary": {
    "total_steps": 3,
    "regressions": 1,
    "improvements": 1,
    "persistent_failures": 0,
    "unchanged_passes": 1
  }
}
```

### Edge Cases

**Fewer than 2 runs:** If the suite has only one run and no `run_id_a`/`run_id_b` are provided, returns `{ "error": "Suite 'login-flow' has fewer than 2 runs; cannot auto-compare" }`.

**Runs from different suites:** The `shrike_compare` tool only validates suite membership at the MCP layer (both run IDs must belong to `suite_id`). The HTTP API endpoint `GET /api/compare/:a/:b` additionally enforces `runA.suite_id === runB.suite_id`.

**Step added between runs:** Appears in `new_steps` (no result in A, has result in B).

**Step removed between runs:** Appears in `removed_steps` (has result in A, no result in B). Note: if a suite is re-defined (removing a step), the old step's results are deleted — so removed steps in `shrike_compare` reflect steps that were in the suite at the time of run A but were later removed by re-defining the suite.

**`other_changes`:** Catches transitions not covered by the main categories. Examples: `skip → pass`, `blocked → fail`, `pass → skip`. These are uncommon but valid.

---

## shrike_dashboard

Spawn the web dashboard as a background HTTP server. Returns immediately without waiting for the server to be ready. If the dashboard is already running, returns its URL without spawning a second instance.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `port` | `integer` | no | `8420` | Port to run the dashboard on |

### Return Value

```typescript
{
  status: "started" | "already_running";
  url: string;   // http://localhost:{port}
  pid: number;   // OS process ID of the dashboard server
}
```

### Examples

**Start dashboard on default port:**

```json
{}
```

Response:

```json
{
  "status": "started",
  "url": "http://localhost:8420",
  "pid": 14382
}
```

**Start on custom port:**

```json
{ "port": 9000 }
```

**Already running:**

```json
{
  "status": "already_running",
  "url": "http://localhost:8420",
  "pid": 14382
}
```

### Edge Cases

**Startup latency:** The dashboard process is spawned asynchronously. The tool returns the URL immediately, but the HTTP server may take 100–500ms to start listening. If you open the URL in a browser immediately, you may briefly see a "connection refused" error. Refreshing once is typically sufficient.

**Port already in use:** If the requested port is already occupied by another process (not the CodeShrike dashboard), the spawn will succeed but the Express server inside the child process will crash on `listen()`. The MCP tool returns `"started"` but the URL will be unreachable. Check stderr or try a different port.

**One dashboard per MCP server instance:** The singleton is per-process. If you restart the MCP server (e.g., by restarting Claude Code), the old dashboard process may still be running on the port. In that case, either kill it manually or use a different port.

**Project path:** The dashboard server is passed the same `--project-path` as the MCP server. It opens the same SQLite database and serves screenshots from the same `.codeshrike/` directory. You do not need to configure the dashboard separately.
