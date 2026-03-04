# CodeShrike — Scope Layers

CodeShrike uses 8 scope layers to tag test steps. Every step must belong to exactly one layer. The layer system forces explicit decisions about what is being verified and makes coverage gaps visible at a glance.

Related: [Tool Reference](tools.md) | [Integration Guide](integration.md) | [Dashboard](dashboard.md)

---

## Why Layers Matter

Without layers, "this feature is tested" is meaningless. With layers, you can ask specific questions:

- Did we test that the UI shows the right thing, or just that it doesn't crash?
- Did we test that the API rejects unauthorized requests, or just that it accepts valid ones?
- Did we test that data is actually written to the database, or just that the function returns without error?
- Did we test that files are truly unreadable, or just that the permission checkbox is checked?

Each layer answers a different question. A suite with 10 steps all in the `ui` layer is shallow, no matter how thorough those steps are. A suite spread across `ui`, `api`, `logic`, `data`, and `auth` is genuinely deep.

---

## The 8 Layers

### `ui`

**What it tests:** Visual rendering, layout, interactive state, and user interaction in the browser.

**What it proves:** The user-facing interface behaves correctly. Elements appear as expected. User interactions trigger the right responses. State is visually reflected correctly.

**Not sufficient for:** Proving that backend operations actually happened. The UI may show "saved" while the database write failed.

**Good test steps for `ui`:**

- "Login form renders with email field, password field, and submit button enabled"
- "Error message 'Email already in use' appears after submitting a duplicate email"
- "Item is removed from the cart UI immediately on clicking 'Remove'"
- "Progress bar updates in real time during file upload"
- "Keyboard navigation: Tab moves focus through form fields in correct order"

**Example:**

```json
{
  "step_id": "empty-state-shown",
  "name": "Empty state illustration shown when no items exist",
  "layer": "ui",
  "expected": "SVG illustration and 'No items yet' text visible. 'Add your first item' button present."
}
```

---

### `api`

**What it tests:** HTTP endpoint contracts — request handling, response shape, status codes, error responses, and input validation.

**What it proves:** The API behaves according to its contract. The right status codes are returned for the right inputs. Error payloads are correctly structured. Required fields are validated.

**Not sufficient for:** Proving side effects (database writes, emails sent, files created). An API can return 200 while silently failing to commit the transaction.

**Good test steps for `api`:**

- "POST /api/users returns 201 with { id, email, created_at } on valid input"
- "POST /api/users returns 409 Conflict when email already exists"
- "PUT /api/posts/:id returns 403 Forbidden when caller is not the post owner"
- "GET /api/search?q= returns 400 Bad Request when query is empty"
- "DELETE /api/sessions returns 200 and clears the session cookie"

**Example:**

```json
{
  "step_id": "create-user-api",
  "name": "POST /api/users creates user and returns 201",
  "layer": "api",
  "expected": "HTTP 201. Body: { id: uuid, email: string, created_at: ISO8601 }. No password field in response."
}
```

---

### `logic`

**What it tests:** Business rules, computation, state machine transitions, and pure functions — independent of UI and I/O.

**What it proves:** The core application logic produces correct outputs for given inputs. Business rules are correctly implemented. Edge cases are handled.

**Not sufficient for:** Proving that the logic is actually invoked in the real application flow. Unit-tested logic can be correctly implemented but never called from the API handler.

**Good test steps for `logic`:**

- "Coupon discount of 10% applies correctly to order total of $47.96 → $43.16"
- "Password complexity rule rejects passwords shorter than 8 characters"
- "Tax calculation returns 0 for orders shipped to tax-exempt states"
- "Paginator returns empty array when page * limit > total count"
- "Rate limiter allows exactly 10 requests per minute, blocks the 11th"

**Example:**

```json
{
  "step_id": "refund-calculation",
  "name": "Partial refund calculates pro-rated amount correctly",
  "layer": "logic",
  "expected": "For a $120 order with 3 items, refunding 1 item returns $40. Refund = total / item_count."
}
```

---

### `data`

**What it tests:** Database reads and writes — query correctness, schema integrity, persistence, and relational constraints.

**What it proves:** Data is actually written to and read from persistent storage correctly. The schema enforces constraints. Queries return the right records. No silent data corruption.

**Not sufficient for:** Proving that the data is displayed to the user or accessible via the API. You can have correct data operations with a broken UI or missing API route.

**Good test steps for `data`:**

- "Creating a user inserts a row into the users table with correct email and null password_reset_token"
- "Deleting a project cascades to delete all associated tasks (ON DELETE CASCADE)"
- "Unique constraint on users.email prevents duplicate inserts"
- "orders.total_cents is stored as an integer, not a float — no rounding errors"
- "Soft-deleted records have deleted_at set, not removed from table"

**Example:**

```json
{
  "step_id": "cascade-delete-tasks",
  "name": "Deleting a project removes all its tasks",
  "layer": "data",
  "expected": "After DELETE FROM projects WHERE id = 'p1', SELECT COUNT(*) FROM tasks WHERE project_id = 'p1' returns 0"
}
```

---

### `filesystem`

**What it tests:** File creation, deletion, reading, writing, permissions, and directory structure.

**What it proves:** The application correctly interacts with the filesystem. Files are created where expected. Permissions are enforced. Cleanup happens correctly. Storage limits are respected.

**Not sufficient for:** Proving that the API or UI correctly triggers these operations. Filesystem tests are typically lower-level — they verify that the underlying file operations themselves are correct.

**Good test steps for `filesystem`:**

- "Uploaded file is stored at uploads/{user_id}/{filename}, not at uploads/{filename}"
- "After deleting a file through the app, the physical file is removed from disk"
- "View-only share token cannot write to the file — returns EACCES"
- "Temp files created during processing are removed after the operation completes"
- "Storage quota check prevents file upload when user is at 100% capacity"

**Example:**

```json
{
  "step_id": "file-permissions-enforced",
  "name": "View-only share cannot write to file on disk",
  "layer": "filesystem",
  "expected": "Attempting fs.writeFile() with view-only credentials throws EACCES. File contents unchanged."
}
```

---

### `auth`

**What it tests:** Authentication (who are you?), authorization (are you allowed?), session management, token lifecycle, and access control rules.

**What it proves:** Security boundaries are enforced. Unauthenticated requests are rejected. Users can only access their own resources. Tokens have the right scope and expiry. Sessions expire correctly.

**Not sufficient for:** Proving that the underlying data or UI is secure — auth tests only verify the security enforcement layer itself.

**Good test steps for `auth`:**

- "Unauthenticated request to GET /api/profile returns 401 Unauthorized"
- "User A cannot read User B's private files — returns 403 Forbidden"
- "JWT token expires after 24 hours — subsequent request with expired token returns 401"
- "Password reset token is single-use — second use returns 400 Invalid token"
- "Admin role can access /api/admin, regular user gets 403"

**Example:**

```json
{
  "step_id": "token-single-use",
  "name": "Password reset token can only be used once",
  "layer": "auth",
  "expected": "First use: 200 OK, password updated. Second use with same token: 400 { error: 'token_already_used' }"
}
```

---

### `integration`

**What it tests:** Calls across service boundaries — third-party APIs, message queues, email providers, payment processors, webhooks, and any external dependency.

**What it proves:** The application correctly communicates with external systems. Requests are formatted correctly. Responses are handled correctly. Failure modes are handled gracefully.

**Not sufficient for:** Proving that the internal business logic or UI is correct. Integration tests specifically focus on the boundary between your system and an external system.

**Good test steps for `integration`:**

- "Stripe is called with the correct amount in cents and currency code on checkout"
- "Order confirmation email is delivered to the recipient within 60 seconds"
- "S3 upload completes successfully and returns a valid presigned URL"
- "Webhook from payment provider updates order status from 'pending' to 'paid'"
- "Slack notification sent to #deployments channel on successful deploy"

**Example:**

```json
{
  "step_id": "stripe-charge-amount",
  "name": "Stripe charge is created with correct amount",
  "layer": "integration",
  "expected": "Stripe API receives { amount: 4796, currency: 'usd' }. charge.id returned and stored in orders.stripe_charge_id."
}
```

---

### `performance`

**What it tests:** Response time, throughput, resource consumption under load, and degradation behavior.

**What it proves:** The application meets latency and throughput requirements. It does not degrade unacceptably under expected load. Expensive operations are within acceptable bounds.

**Not sufficient for:** Proving correctness — a fast wrong answer is still wrong. Performance tests assume functional correctness and verify non-functional behavior.

**Good test steps for `performance`:**

- "GET /api/search returns results in under 200ms for a query against 10,000 records"
- "Uploading a 10MB file completes in under 5 seconds on a 100Mbps connection"
- "Dashboard page loads in under 1 second (LCP) on a mid-tier device"
- "Concurrent 100 requests to POST /api/checkout complete with zero 5xx errors"
- "Memory usage stays below 512MB after processing 1000 orders sequentially"

**Example:**

```json
{
  "step_id": "search-latency",
  "name": "Search API responds in under 200ms at p99",
  "layer": "performance",
  "expected": "100 sequential search requests: p50 < 50ms, p99 < 200ms. No request exceeds 500ms."
}
```

---

## Coverage Computation

### How It Works

Coverage is computed by comparing two things:

1. **Intended layers** (`suite.layers`) — The layers declared when the suite was defined. This is the agent's commitment: "I intend to test these aspects."

2. **Actual layers** — The distinct layers present in the suite's step definitions. If all steps are `ui`, then `actual = ["ui"]`.

**Gaps** = intended layers that have no steps.

This is a suite-design check, not a test execution check. It catches cases where an agent declares intent but doesn't follow through.

### Coverage at Execution Time

During a run, coverage additionally considers which layers had step results recorded. A layer can have steps but have all of them skipped or blocked — in this case the layer is technically covered by the suite definition but not exercised in this run.

The dashboard's Run Detail view shows this per-run picture. The Coverage Matrix view (`/api/coverage`) shows the suite-definition picture (steps per layer, regardless of run status).

### Health Labels

The `health` field on the coverage API response uses this logic:

```
EMPTY   → suite has no steps at all
GAP     → intended layer has zero steps (suite_definition gap)
SHALLOW → no gaps, but only 1 or 2 distinct layers covered
OK      → no gaps, 3+ distinct layers covered
```

### Example: Identifying Gaps

Consider a suite for a "file upload" feature:

```json
{
  "suite_id": "file-upload",
  "layers": ["ui", "api", "filesystem", "auth"],
  "steps": [
    { "step_id": "upload-button-visible", "layer": "ui", ... },
    { "step_id": "upload-api-accepts-multipart", "layer": "api", ... },
    { "step_id": "upload-api-rejects-unauthenticated", "layer": "api", ... }
  ]
}
```

Coverage analysis:
- Intended: `["ui", "api", "filesystem", "auth"]`
- Actual: `["ui", "api"]`
- Gaps: `["filesystem", "auth"]`

This immediately surfaces two missing concerns: no test verifies that the file actually lands on disk, and no test verifies that the storage path is user-isolated (an auth concern).

The Coverage Matrix in the dashboard will show these gaps in red, prompting the team to add steps or update the `layers` declaration if `filesystem` and `auth` were mistakenly included.

---

## Choosing the Right Layer

When you're unsure which layer a step belongs to, ask: **what system is this step actually exercising?**

| Question | Layer |
|----------|-------|
| "Does the user see the right thing?" | `ui` |
| "Does the HTTP endpoint return the right response?" | `api` |
| "Does the business rule compute the right answer?" | `logic` |
| "Is the data in the database correct?" | `data` |
| "Is the file on disk / permissions correct?" | `filesystem` |
| "Is access correctly allowed/denied?" | `auth` |
| "Did the external service get called correctly?" | `integration` |
| "Is it fast enough?" | `performance` |

A single user action often spans multiple layers. "User submits a form to create an account" involves:
- `ui` — the form rendered and submitted
- `api` — the endpoint returned 201
- `logic` — email validation passed
- `data` — the user row was written
- `auth` — the session was created

These are 5 separate steps, each testing a different concern. Don't collapse them into one step — the value of CodeShrike is exactly this explicitness.
