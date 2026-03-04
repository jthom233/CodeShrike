# CodeShrike — Integration Guide

How AI agents use CodeShrike. This document covers the visual agent workflow, the tester agent workflow, the orchestrator workflow, and a complete end-to-end example of the test lifecycle.

Related: [Tool Reference](tools.md) | [Scope Layers](scope-layers.md) | [Architecture](architecture.md)

---

## The Core Idea

CodeShrike makes agent testing **verifiable by humans**. The pattern is:

1. **Define** — Create a test suite once with named steps and scope layers.
2. **Record** — Every time the agent runs tests, record results against the suite.
3. **Query** — Use the suite to guide what still needs to be tested.
4. **Review** — Humans open the dashboard to see exactly what was tested, at what depth, with screenshots.
5. **Compare** — When code changes, compare the new run against the previous baseline to find regressions.

---

## Visual Agent Workflow

A visual agent (using `chrome-devtools-mcp` for browser automation) follows this workflow for each testing session.

### Step 1: Check for an Existing Suite

Before creating a suite, check if one already exists. Suites persist across sessions.

```json
{ "tool": "shrike_query", "arguments": { "suite_id": "login-flow" } }
```

If the suite exists, the agent can skip `shrike_define` and go directly to recording.

### Step 2: Define the Suite (if new)

```json
{
  "tool": "shrike_define",
  "arguments": {
    "suite_id": "login-flow",
    "name": "Login Flow",
    "description": "UI and auth testing for the login page",
    "layers": ["ui", "api", "auth"],
    "steps": [
      {
        "step_id": "login-form-renders",
        "name": "Login form renders correctly",
        "layer": "ui",
        "expected": "Email field, password field, and submit button are visible and enabled"
      },
      {
        "step_id": "invalid-credentials-rejected",
        "name": "Invalid credentials show error message",
        "layer": "ui",
        "expected": "Error message 'Invalid email or password' appears below the form"
      },
      {
        "step_id": "valid-login-redirects",
        "name": "Valid credentials redirect to dashboard",
        "layer": "ui",
        "expected": "After submit, URL changes to /dashboard and user greeting is visible"
      },
      {
        "step_id": "api-auth-endpoint",
        "name": "POST /api/auth/login returns 200 with token",
        "layer": "api",
        "expected": "Response body contains { token, user_id, expires_at } with HTTP 200"
      },
      {
        "step_id": "session-cookie-set",
        "name": "HttpOnly session cookie written after login",
        "layer": "auth",
        "expected": "Cookie 'session' present, HttpOnly=true, Secure=true, SameSite=Strict"
      }
    ]
  }
}
```

### Step 3: Execute and Record Each Step

The agent runs each step using `chrome-devtools-mcp` tools (`navigate_page`, `take_screenshot`, `evaluate_script`, etc.), then records the result. Steps can be recorded individually or in batches.

**Navigate and capture:**

```
navigate_page to https://app.example.com/login
take_screenshot to /tmp/codeshrike/login-form.png
```

**Record the result:**

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "login-flow",
    "run_label": "PR #241 — auth middleware refactor",
    "results": [
      {
        "step_id": "login-form-renders",
        "status": "pass",
        "screenshot_path": "/tmp/codeshrike/login-form.png",
        "actual": "All three elements visible. Email field focused by default."
      }
    ]
  }
}
```

The response tells the agent how many steps remain:

```json
{
  "run_id": "run_aB3kX9mNpQ4r",
  "recorded": 1,
  "run_progress": { "total": 5, "passed": 1, "failed": 0, "skipped": 0, "blocked": 0, "untested": 4 },
  "remaining_steps": [
    { "step_id": "invalid-credentials-rejected", "name": "Invalid credentials show error message", "layer": "ui" },
    { "step_id": "valid-login-redirects", "name": "Valid credentials redirect to dashboard", "layer": "ui" },
    { "step_id": "api-auth-endpoint", "name": "POST /api/auth/login returns 200 with token", "layer": "api" },
    { "step_id": "session-cookie-set", "name": "HttpOnly session cookie written after login", "layer": "auth" }
  ]
}
```

The agent uses `remaining_steps` as its work queue, ensuring no steps are skipped.

### Step 4: Handle Blocked Steps

When a later step cannot be executed because an earlier step failed:

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "login-flow",
    "results": [
      {
        "step_id": "session-cookie-set",
        "status": "blocked",
        "notes": "Cannot verify cookie — login redirect failed in previous step"
      }
    ]
  }
}
```

`blocked` is distinct from `fail`. It says "I didn't run this step because a prerequisite failed" — which preserves the causal chain and prevents false failures.

### Step 5: Close the Run

After recording all steps (or as many as possible):

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "login-flow",
    "results": [],
    "_complete": true
  }
}
```

Or combine with the last step:

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "login-flow",
    "results": [
      { "step_id": "api-auth-endpoint", "status": "pass", "actual": "200 with token, user_id, expires_at present" }
    ],
    "_complete": true
  }
}
```

---

## Tester Agent Workflow

A tester agent runs automated tests (unit, integration) and uses CodeShrike to record structured results rather than just printing test output.

### Define the Suite

```json
{
  "tool": "shrike_define",
  "arguments": {
    "suite_id": "auth-service-unit",
    "name": "Auth Service — Unit Tests",
    "layers": ["logic", "data"],
    "steps": [
      {
        "step_id": "hash-password-bcrypt",
        "name": "hashPassword() produces bcrypt hash",
        "layer": "logic",
        "expected": "Returns string starting with $2b$, length 60"
      },
      {
        "step_id": "verify-password-correct",
        "name": "verifyPassword() returns true for correct password",
        "layer": "logic",
        "expected": "Async returns true when plaintext matches stored hash"
      },
      {
        "step_id": "verify-password-wrong",
        "name": "verifyPassword() returns false for wrong password",
        "layer": "logic",
        "expected": "Async returns false when plaintext does not match"
      },
      {
        "step_id": "token-expires-claim",
        "name": "Generated JWT contains correct exp claim",
        "layer": "logic",
        "expected": "exp = iat + 86400 (24 hours)"
      },
      {
        "step_id": "user-record-updated-on-login",
        "name": "last_login_at updated in DB after successful auth",
        "layer": "data",
        "expected": "users.last_login_at within 1 second of current time after auth call"
      }
    ]
  }
}
```

### Run Tests and Record

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "auth-service-unit",
    "run_label": "main branch — commit f7a3b91",
    "results": [
      { "step_id": "hash-password-bcrypt", "status": "pass", "actual": "Hash: $2b$10$K8...Lg (60 chars)" },
      { "step_id": "verify-password-correct", "status": "pass", "actual": "verifyPassword() returned true in 82ms" },
      { "step_id": "verify-password-wrong", "status": "pass", "actual": "verifyPassword() returned false in 79ms" },
      { "step_id": "token-expires-claim", "status": "fail", "actual": "exp = iat + 3600 (1 hour), expected 86400. Token TTL was changed without updating test expectation." },
      { "step_id": "user-record-updated-on-login", "status": "pass", "actual": "last_login_at = 2025-08-12T14:33:01, current time = 2025-08-12T14:33:01" }
    ],
    "_complete": true
  }
}
```

---

## Orchestrator Workflow

The orchestrator uses CodeShrike to coordinate testing across agents and monitor coverage.

### Before Dispatching Agents

Check what suites already exist and what their health is:

```json
{ "tool": "shrike_query", "arguments": {} }
```

Check for any suites with failures:

```json
{ "tool": "shrike_query", "arguments": { "status_filter": "failing_suites" } }
```

### After Verification Phase

After all testing agents have run, check for failures:

```json
{ "tool": "shrike_query", "arguments": { "status_filter": "failing_suites" } }
```

If there are failing suites, dispatch agents to investigate. Include the run_id for context:

```json
{ "tool": "shrike_query", "arguments": { "run_id": "run_aB3kX9mNpQ4r" } }
```

### After Code Changes

Compare the new run against the previous baseline to find regressions:

```json
{ "tool": "shrike_compare", "arguments": { "suite_id": "login-flow" } }
```

If `regressions` is non-empty, dispatch a developer agent to investigate.

### Launch Dashboard for Human Review

```json
{ "tool": "shrike_dashboard", "arguments": {} }
```

Report the URL to the user: "The test dashboard is available at http://localhost:8420. Login Flow has 1 regression in the api layer — POST /api/auth/login now returns 401."

---

## Complete Test Lifecycle Example

This example shows a full test session for a feature: file sharing permissions.

### Context

The feature allows users to share files with "view only" or "edit" permissions. A visual agent is tasked with testing it.

### 1. Check for Existing Suite

```json
{ "tool": "shrike_query", "arguments": { "suite_id": "file-sharing-permissions" } }
```

Response: `{ "error": "Suite not found: file-sharing-permissions" }` — suite doesn't exist yet.

### 2. Define the Suite

```json
{
  "tool": "shrike_define",
  "arguments": {
    "suite_id": "file-sharing-permissions",
    "name": "File Sharing Permissions",
    "description": "Tests that view-only and edit permission enforcement works at every layer",
    "layers": ["ui", "api", "filesystem", "auth"],
    "steps": [
      {
        "step_id": "share-dialog-renders",
        "name": "Share dialog shows permission options",
        "layer": "ui",
        "expected": "Dialog shows 'View only' and 'Can edit' radio buttons, recipient email input, and Share button"
      },
      {
        "step_id": "view-only-ui-restrictions",
        "name": "View-only recipient sees no edit controls",
        "layer": "ui",
        "expected": "Edit button absent. Rename option absent. Download button present."
      },
      {
        "step_id": "edit-permission-api-enforcement",
        "name": "PUT /api/files/:id blocked for view-only recipient",
        "layer": "api",
        "expected": "HTTP 403 Forbidden with body { error: 'insufficient_permissions' }"
      },
      {
        "step_id": "view-only-filesystem-enforcement",
        "name": "View-only recipient cannot write to file on disk",
        "layer": "filesystem",
        "expected": "Direct filesystem write attempt returns EACCES permission denied"
      },
      {
        "step_id": "share-token-scope-in-jwt",
        "name": "Share token JWT contains correct scope claim",
        "layer": "auth",
        "expected": "JWT payload has { scope: 'read', file_id: '...', expires_at: ... }. Edit scope not present."
      }
    ]
  }
}
```

Response: `{ "suite_id": "file-sharing-permissions", "version": 1, "step_count": 5, "step_ids": [...] }`

### 3. Execute the Test Steps

The agent executes each step using browser automation, then records results in batches.

**Batch 1 — UI steps:**

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "file-sharing-permissions",
    "run_label": "Feature branch: feat/file-sharing",
    "results": [
      {
        "step_id": "share-dialog-renders",
        "status": "pass",
        "screenshot_path": "/tmp/tests/share-dialog.png",
        "actual": "Dialog shows both permission options. Email input present. Share button enabled."
      },
      {
        "step_id": "view-only-ui-restrictions",
        "status": "pass",
        "screenshot_path": "/tmp/tests/view-only-recipient.png",
        "actual": "Edit and Rename buttons absent. Download button visible."
      }
    ]
  }
}
```

**Batch 2 — API step:**

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "file-sharing-permissions",
    "results": [
      {
        "step_id": "edit-permission-api-enforcement",
        "status": "fail",
        "actual": "PUT /api/files/f123 returned HTTP 200 for view-only share token. File was modified.",
        "notes": "Critical security regression — API permission check not wired up in new file handler"
      }
    ]
  }
}
```

**Batch 3 — Filesystem and auth (downstream steps blocked by API failure):**

```json
{
  "tool": "shrike_record",
  "arguments": {
    "suite_id": "file-sharing-permissions",
    "results": [
      {
        "step_id": "view-only-filesystem-enforcement",
        "status": "blocked",
        "notes": "API allows writes, so filesystem test cannot distinguish permission failure from correct behavior"
      },
      {
        "step_id": "share-token-scope-in-jwt",
        "status": "pass",
        "actual": "JWT payload: { scope: 'read', file_id: 'f123', expires_at: '2025-09-12T14:32:01Z' }. No 'write' scope."
      }
    ],
    "_complete": true
  }
}
```

### 4. Check Run Summary

```json
{ "tool": "shrike_query", "arguments": { "run_id": "run_xyz" } }
```

Response includes:

```json
{
  "run": { "status": "completed", "summary": { "total": 5, "passed": 3, "failed": 1, "blocked": 1, "untested": 0 } },
  "results": [ ... ]
}
```

### 5. Report to Orchestrator

The agent includes the `run_id` in its handoff report:

> "File sharing permissions test complete. Run ID: `run_xyz`. 3 passed, 1 failed (`edit-permission-api-enforcement` — API does not enforce view-only on PUT), 1 blocked (filesystem test cannot validate while API allows writes). The JWT scope is correctly set to `read`. The enforcement gap is in the API layer. Dashboard: http://localhost:8420"

### 6. Developer Fixes the Bug

The developer fixes the missing permission check.

### 7. Re-run and Compare

After the fix is merged, the agent runs the suite again (same suite_id, new run). Then:

```json
{ "tool": "shrike_compare", "arguments": { "suite_id": "file-sharing-permissions" } }
```

Response:

```json
{
  "improvements": [
    { "step_id": "edit-permission-api-enforcement", "status_a": "fail", "status_b": "pass", ... }
  ],
  "regressions": [],
  "persistent_failures": [],
  "unchanged_passes": [
    { "step_id": "share-dialog-renders", ... },
    { "step_id": "view-only-ui-restrictions", ... },
    { "step_id": "share-token-scope-in-jwt", ... }
  ],
  "summary": { "regressions": 0, "improvements": 1, "persistent_failures": 0 }
}
```

The fix verified. Previously blocked step (`view-only-filesystem-enforcement`) can now be re-tested.

---

## Best Practices

**Use descriptive `run_label` values.** Labels like `"PR #241 pre-merge"`, `"main after deploy"`, `"nightly 2025-08-12"` make the run history in the dashboard immediately readable.

**Record step by step, not all at once.** The `remaining_steps` in each response is your guide. This prevents skipping steps and makes partial results visible if the agent is interrupted.

**Use `blocked` correctly.** A step is `blocked` when it logically cannot be executed because a prerequisite failed — not when you don't have time to run it (`skip`) or when it fails to execute (`fail`).

**Don't re-define suites every session.** Suites are persistent. Re-define only when the test coverage needs to change. Each re-definition bumps the version and clears all prior step results.

**Include screenshots on failures.** Screenshots on `fail` steps are the most valuable evidence. Passing steps with screenshots are also useful for establishing visual baselines.

**Capture screenshots before recording.** The `screenshot_path` must exist when `shrike_record` is called. Capture the screenshot first, then record.

**Let `remaining_steps` drive your loop.** After each batch recording, check `remaining_steps` in the response rather than keeping your own list. This handles cases where the suite definition was updated between sessions.
