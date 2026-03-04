PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
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
