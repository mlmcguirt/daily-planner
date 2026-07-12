-- Daily Planner schema for Cloudflare D1
-- One row per (space, date). "space" is derived from your passphrase so
-- your data is separated from anyone else who might hit the URL.
--
-- Safe to re-run: every statement is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS planner_days (
  space TEXT NOT NULL,          -- hashed passphrase (who this belongs to)
  day_date TEXT NOT NULL,       -- e.g. "2026-07-11"
  data TEXT NOT NULL,           -- JSON blob: blocks, todos, weekday
  updated_at TEXT NOT NULL,     -- ISO timestamp; also the version for conflict detection
  PRIMARY KEY (space, day_date)
);

-- Recurring todos belong to a space, not to any one day. They're merged into the
-- checklist when you open a day whose weekday matches.
CREATE TABLE IF NOT EXISTS planner_recurring (
  space TEXT NOT NULL,
  id TEXT NOT NULL,             -- stable id; copied onto the day's todo so it can't duplicate
  text TEXT NOT NULL,
  weekdays TEXT NOT NULL,       -- comma-separated, Mon=0 .. Sun=6, e.g. "0,2,4"
  target TEXT NOT NULL DEFAULT 'todo',  -- where it comes back: 'todo' | morning | afternoon | evening | notes
  created_at TEXT NOT NULL,
  PRIMARY KEY (space, id)
);

-- Existing databases predate `target`. SQLite has no ADD COLUMN IF NOT EXISTS, so
-- this errors harmlessly ("duplicate column name") once it has already been applied.
-- ALTER TABLE planner_recurring ADD COLUMN target TEXT NOT NULL DEFAULT 'todo';

-- Search scans a space's days newest-first.
CREATE INDEX IF NOT EXISTS idx_days_space_date ON planner_days (space, day_date DESC);
