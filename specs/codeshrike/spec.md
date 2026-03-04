# CodeShrike — Test Management MCP Server

## Overview

CodeShrike is an MCP server that provides persistent test suite management for AI agents. Agents create, maintain, and execute organized test suites with named steps, scope layer tags, and screenshots. A web dashboard lets humans verify that agents tested the right things at the right depth.

**Tagline:** *Pin every result. Miss nothing.*

**Brand family:** CodeGiraffe (architecture) → CodeLynx (code intelligence) → CodeShrike (test management)

## Problem Statement

AI agents claim tests pass when they haven't tested the full scope. Example: "Test file share permissions" — agent tests UI components (checkboxes render, form submits) and reports PASS, but never tests actual filesystem enforcement (can a read-only user write files?). The human has no way to verify what was actually tested.

Current state:
- No persistent test library — every session starts from scratch
- No organized test steps — agents produce free-form reports
- No scope coverage visibility — humans can't see testing depth
- No screenshot-to-step matching — evidence is scattered
- Test knowledge doesn't accumulate across sessions

## Requirements

### R1: Test Suite Management
- Agents MUST be able to create named test suites with descriptions
- Suites MUST contain ordered, named test steps with expected outcomes
- Each step MUST be tagged with a scope layer (ui, api, logic, data, filesystem, auth, integration, performance)
- Suites MUST declare which scope layers they intend to cover
- Suites MUST be versioned — modifications bump the version
- Suite definitions persist across sessions

### R2: Test Execution Recording
- Agents MUST be able to record step results (pass/fail/skip/blocked) with actual outcomes
- First recording auto-creates a test run (no explicit start ceremony)
- Runs auto-close after configurable timeout if agent disappears
- Steps not recorded remain as "untested" (visible gap)
- Each run snapshots the suite version at creation time

### R3: Screenshot Association
- Agents MUST be able to attach screenshots to step results via file path
- Screenshots are copied into managed storage organized by suite/run/step
- Screenshot naming matches step names for human readability
- Support PNG format (lossless for potential future diffing)

### R4: Scope Coverage Computation
- Server MUST compute scope coverage after each run by analyzing which layers have step results
- Coverage compares intended layers (from suite definition) vs executed layers (from step results)
- Gap layers (intended but not executed) are explicitly identified
- Coverage is computed server-side — agents cannot self-report coverage

### R5: Query and Retrieval
- Agents MUST be able to list existing suites with latest run summary
- Agents MUST be able to retrieve full run details with step results
- Support filtering by status (failing suites, specific step status)
- Return remaining untested steps after each recording (guides agent completion)

### R6: Run Comparison
- Support comparing two runs of the same suite
- Identify regressions (pass→fail), improvements (fail→pass), persistent failures
- Include screenshot references for changed steps

### R7: Web Dashboard
- Serve a web dashboard on localhost via a spawned HTTP process
- Dashboard launched by a `shrike_dashboard` tool call
- Views: Suite Library, Suite Detail, Run Detail, Coverage Matrix
- Coverage Matrix shows suites × scope layers with gap highlighting
- Keyboard-navigable, dark theme, developer-tool aesthetic
- Dashboard is read-only — data comes from SQLite via API

### R8: Storage
- SQLite database for structured data (WAL mode for concurrent read/write)
- Filesystem for screenshots organized by suite/run
- Project-local storage in `.codeshrike/` directory
- `.codeshrike/` added to `.gitignore` by default

## Scope Layers

| Layer | What It Proves | Example |
|-------|---------------|---------|
| ui | UI renders and responds correctly | Screenshot of form, visual layout |
| api | Correct HTTP calls with correct payloads | API response validation |
| logic | Business logic processes correctly | Computation verification |
| data | Data persisted/retrieved correctly | Database state check |
| filesystem | OS-level file operations work | File write/read verification |
| auth | Authentication/authorization enforced | Token validation, access control |
| integration | Cross-service propagation works | Event delivery, sync verification |
| performance | Latency/throughput acceptable | Response time measurement |

## MCP Tool Interface (4 core tools)

### shrike_define
Create or update a test suite with all steps in one call. Idempotent by suite_id.

Parameters:
- suite_id (string, required) — kebab-case identifier
- name (string, required) — human-readable name
- description (string, optional)
- layers (string[], required) — intended scope layers
- steps (array, required):
  - step_id (string) — kebab-case identifier
  - name (string) — verification-level description
  - layer (string) — which scope layer
  - expected (string) — what success looks like

Returns: suite_id, version, step_count, step_ids

### shrike_record
Record results for one or more steps. Auto-creates run if none active. Auto-closes on timeout.

Parameters:
- suite_id (string, required)
- run_label (string, optional) — descriptive label for this run
- results (array, required):
  - step_id (string)
  - status (enum: pass/fail/skip/blocked)
  - actual (string, optional) — what actually happened
  - screenshot_path (string, optional) — absolute path to screenshot file
  - notes (string, optional)
- _complete (boolean, optional) — if true, closes the run

Returns: run_id, recorded count, run_progress (total/passed/failed/skipped/blocked/untested), remaining_steps

### shrike_query
Retrieve suites, runs, and results with flexible filtering.

Parameters:
- suite_id (string, optional) — filter to specific suite
- run_id (string, optional) — filter to specific run
- status_filter (enum: all/pass/fail/skip/blocked/untested/failing_suites)
- include_steps (boolean, optional)
- limit (integer, optional, default 1)

Returns: suites array with latest run summary, step details when requested

### shrike_compare
Compare two runs of the same suite.

Parameters:
- suite_id (string, required)
- run_id_a (string, optional) — defaults to second-most-recent
- run_id_b (string, optional) — defaults to most recent

Returns: regressions, improvements, persistent_failures, unchanged_passes, summary

### shrike_dashboard
Spawn the web dashboard.

Parameters:
- port (integer, optional, default 8420)

Returns: URL of running dashboard

## User Stories

### US1: Agent Creates a Test Suite
As an AI testing agent, I want to define a test suite with named steps and scope layers so that my test plan is organized and persistent.

### US2: Agent Executes and Records Tests
As an AI testing agent, I want to record pass/fail results with screenshots for each step so that evidence is matched to assertions.

### US3: Human Reviews Coverage
As a human developer, I want to see a coverage matrix showing which scope layers each suite tests so that I can identify where agents only tested the surface.

### US4: Human Reviews Test Run
As a human developer, I want to scrub through a test run step-by-step with screenshots so that I can verify the agent tested correctly.

### US5: Agent Resumes Existing Suite
As an AI testing agent, I want to query existing suites so that I can re-run tests without redefining them.

### US6: Orchestrator Detects Gaps
As the orchestrator agent, I want to query coverage so that I can dispatch agents to fill testing gaps.

## Acceptance Criteria

- AC1: `shrike_define` creates a suite retrievable via `shrike_query`
- AC2: `shrike_record` auto-creates runs and records step results with screenshots
- AC3: Untested steps appear as "untested" in query results
- AC4: Scope coverage is computed server-side matching intended vs actual layers
- AC5: Coverage Matrix dashboard view shows gaps with visual highlighting
- AC6: Run Detail view shows step-by-step screenshots matched to assertions
- AC7: `shrike_compare` identifies regressions between runs
- AC8: Runs auto-close after timeout with partial results preserved
- AC9: Data persists across Claude Code sessions
- AC10: Dashboard serves on localhost without external dependencies
