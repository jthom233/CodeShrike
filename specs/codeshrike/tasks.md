# CodeShrike — Task Breakdown

## Phase 1: Core MCP Server (can be parallelized internally)

### Task 1.1: Project Scaffolding
**Priority:** P0 — blocks everything
**Estimate:** Small
**Files:** package.json, tsconfig.json, src/index.ts
**Description:** Initialize TypeScript project with MCP SDK, better-sqlite3, zod, nanoid. Set up build pipeline (tsc). Create entry point with McpServer + StdioServerTransport. Register placeholder tools.
**Acceptance:** `npm run build` succeeds, MCP Inspector connects and lists tools.

### Task 1.2: Database Layer
**Priority:** P0 — blocks tools
**Depends on:** 1.1
**Files:** src/db/connection.ts, src/db/schema.sql, src/db/queries.ts
**Description:** SQLite connection with WAL mode, busy_timeout, foreign_keys. Migration runner (version table + schema.sql). Prepared statement wrappers for all CRUD operations (suites, steps, runs, step_results). Auto-create .codeshrike/ directory and .gitignore.
**Acceptance:** Database created on first run, schema applied, queries work in tests.

### Task 1.3: Screenshot Storage
**Priority:** P1 — blocks shrike_record
**Depends on:** 1.1
**Files:** src/storage/screenshots.ts
**Description:** File copy from source path to managed storage (.codeshrike/screenshots/{suite_id}/{run_id}/{ordinal}-{step_id}.png). Path resolution. Directory creation. Validation that source file exists.
**Acceptance:** Screenshots copied with correct naming, missing source returns warning not error.

### Task 1.4: shrike_define Tool
**Priority:** P0 — first user-facing tool
**Depends on:** 1.2
**Files:** src/tools/define.ts
**Description:** Implement create-or-update logic. Zod input schema. Suite upsert (name, description, layers). Step replacement (delete old, insert new with ordinals). Version bumping on update. Return suite_id, version, step_count, step_ids.
**Acceptance:** Creates new suite, updates existing suite with version bump, validates layer values.

### Task 1.5: shrike_record Tool
**Priority:** P0 — core recording tool
**Depends on:** 1.2, 1.3
**Files:** src/tools/record.ts
**Description:** Auto-create run if none active. Batch insert step_results. Screenshot attachment. _complete flag for explicit close. Auto-close timer (setInterval, 10 min default). Compute run summary on close. Return run_id, progress, remaining_steps.
**Acceptance:** First call creates run, subsequent calls add results, _complete closes run, timeout auto-closes, remaining_steps shows untested steps.

### Task 1.6: shrike_query Tool
**Priority:** P0 — retrieval
**Depends on:** 1.2
**Files:** src/tools/query.ts
**Description:** Flexible query with progressive disclosure. No suite_id → list all suites with latest run. With suite_id → suite detail + steps + runs. With run_id → full step results. Status filtering. Smart include_steps default.
**Acceptance:** All query modes return correct data, status_filter works, failing_suites filter identifies suites with recent failures.

### Task 1.7: shrike_compare Tool
**Priority:** P1 — comparison
**Depends on:** 1.2
**Files:** src/tools/compare.ts
**Description:** Resolve two runs (defaults to last two). Join step_results. Classify as regression/improvement/persistent_failure/unchanged. Include screenshot refs for changed steps.
**Acceptance:** Correctly classifies step status changes, handles missing steps (added/removed between versions).

## Phase 2: Dashboard

### Task 2.1: Dashboard Server
**Priority:** P1
**Depends on:** 1.2
**Files:** src/dashboard/server.ts, src/dashboard/routes.ts, src/tools/dashboard.ts
**Description:** Express server spawned as child process. API routes reading from SQLite (read-only connection). Static file serving for screenshots and SPA assets. shrike_dashboard tool to spawn process and open browser.
**Acceptance:** Dashboard serves on localhost:8420, API returns correct JSON, screenshots load.

### Task 2.2: Suite Library View
**Priority:** P1
**Depends on:** 2.1
**Files:** dashboard/index.html, dashboard/app.js, dashboard/components/suite-list.js, dashboard/styles.css
**Description:** Dark theme SPA shell. Suite table with name, scope layer indicators (filled/empty squares), step count, last run status, health badges (SHALLOW/EMPTY/GAP). Filter input. Keyboard navigation (j/k/Enter//).
**Acceptance:** Lists all suites, layer indicators show coverage, health badges highlight problems.

### Task 2.3: Suite Detail View
**Priority:** P1
**Depends on:** 2.2
**Files:** dashboard/components/suite-detail.js
**Description:** Steps table with ordinal, name, expected, layer tag. Scope coverage summary with gap callout text. Run history table with pass/fail counts and delta column.
**Acceptance:** Shows all steps with layers, scope gaps highlighted in natural language, run history with deltas.

### Task 2.4: Run Detail View
**Priority:** P1
**Depends on:** 2.3
**Files:** dashboard/components/run-viewer.js
**Description:** Step navigator strip (colored cells). Current step display with screenshot, expected/actual, notes. Left/Right arrow scrubbing. Screenshot lazy loading. Space for zoom toggle.
**Acceptance:** Step-by-step slideshow with screenshots, navigator shows pass/fail pattern, keyboard navigation works.

### Task 2.5: Coverage Matrix View
**Priority:** P1
**Depends on:** 2.2
**Files:** dashboard/components/coverage-matrix.js
**Description:** Suites × layers grid. Numbers in cells (step count per layer). Zero cells visually muted. DEPTH column (N/8). HEALTH column with escalating severity. Gap analysis section with natural language explanations.
**Acceptance:** Matrix renders all suites and layers, zeros are dim, gaps are highlighted, health badges escalate correctly.

## Phase 3: Agent Integration (updates to existing files)

### Task 3.1: Update Visual Agent Briefing
**Priority:** P0 — primary CodeShrike consumer
**Depends on:** Phase 1 complete
**Files:** agents/visual.md
**Description:**
- Add `## CodeShrike — Persistent Test Suites` to MCP Tools section
- Update Process steps to integrate shrike_define/shrike_record
- Update Handoff Output Format to include suite_id/run_id reference
- Add prohibition: "Do not report PASS without recording results in CodeShrike"

### Task 3.2: Update Tester Agent Briefing
**Priority:** P0
**Depends on:** Phase 1 complete
**Files:** agents/tester.md
**Description:**
- Add CodeShrike MCP tools subsection
- Add step: query existing suites before defining new ones
- Update deliverables to include persistent suite reference
- Add prohibition: "Do not skip recording results in CodeShrike"

### Task 3.3: Update CLAUDE.md Orchestrator Instructions
**Priority:** P0
**Depends on:** Phase 1 complete
**Files:** CLAUDE.md, ~/.claude/CLAUDE.md
**Description:**
- Phase 4.5 (Spot-Check): Add shrike_query check after tester/visual return
- Phase 5 (Verify): Add CodeShrike awareness to tester/visual dispatch
- Agent table: Update visual/tester descriptions to mention CodeShrike
- Handoff format: Add suite_id/run_id to tester→developer format
- Add CodeShrike to Codegiraffe Tool Selection table equivalent

### Task 3.4: Update MCP.md
**Priority:** P1
**Depends on:** Phase 1 complete
**Files:** MCP.md
**Description:** Add CodeShrike section with install instructions, claude mcp add command, tool reference, and dashboard usage.

### Task 3.5: Update development-flow.md
**Priority:** P1
**Depends on:** Phase 1 complete
**Files:** development-flow.md
**Description:**
- Update tester and visual agent descriptions (MCP usage + output)
- Update Phase 5 verify flow to include CodeShrike
- Add CodeShrike to MCP Servers Required table
- Update architecture diagram to include CodeShrike

### Task 3.6: Update Integrator Agent Briefing (optional)
**Priority:** P2
**Depends on:** Phase 1 complete
**Files:** agents/integrator.md
**Description:** Add CodeShrike tools for persistent contract coverage tracking. Lower priority than visual/tester.

## Phase 4: Testing and Validation

### Task 4.1: Unit Tests for MCP Tools
**Priority:** P1
**Depends on:** Phase 1 complete
**Files:** tests/define.test.ts, tests/record.test.ts, tests/query.test.ts, tests/compare.test.ts
**Description:** Test each tool with in-memory SQLite. Cover: create, update, version bump, batch recording, auto-run creation, timeout, query modes, comparison classification.

### Task 4.2: Integration Test — Full Flow
**Priority:** P1
**Depends on:** Phase 1 + 2 complete
**Files:** tests/integration.test.ts
**Description:** End-to-end: define suite → record results with screenshots → query → compare → dashboard serves. Verify data integrity across the full lifecycle.

### Task 4.3: Live Agent Test
**Priority:** P0
**Depends on:** Phase 1 + 3 complete
**Description:** Dispatch a visual agent to actually use CodeShrike against a real project. Verify: suite created, steps recorded, screenshots attached, remaining_steps guides completion, dashboard shows results.

## Parallel Opportunities

- Tasks 1.4, 1.5, 1.6, 1.7 can run in parallel (all depend on 1.2)
- Tasks 2.2, 2.3, 2.4, 2.5 can run in parallel (all depend on 2.1)
- Tasks 3.1, 3.2, 3.3, 3.4, 3.5 can run in parallel (all depend on Phase 1)
- Phase 2 and Phase 3 can run in parallel (both depend on Phase 1)

## Implementation Order

```
Phase 1: 1.1 → 1.2 → [1.3, 1.4, 1.5, 1.6, 1.7 in parallel]
                         ↓
Phase 2: 2.1 → [2.2, 2.3, 2.4, 2.5 in parallel]     } run in parallel
Phase 3: [3.1, 3.2, 3.3, 3.4, 3.5 in parallel]       }
                         ↓
Phase 4: [4.1, 4.2 in parallel] → 4.3
```
