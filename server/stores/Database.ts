/**
 * Database - SQLite
 *
 *  better-sqlite3 Schema WAL
 *  getDatabase()  +
 *
 * ~/.openteam/openteam.db
 * ./migrations/
 */

import BetterSqlite3 from 'better-sqlite3'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createLogger } from '../lib/logger'
import { OPENTEAM_HOME } from '../config/paths'
import { runMigrations } from './migrations'

const log = createLogger('Database')

export const STORE_DIR = OPENTEAM_HOME
const DB_PATH = join(STORE_DIR, 'openteam.db')

// ── Schema DDL ──

const SCHEMA_V1 = `
-- metadata
CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO _meta (key, value) VALUES ('schema_version', '1');

-- agents
CREATE TABLE IF NOT EXISTS agents (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  icon               TEXT NOT NULL DEFAULT '',
  system_prompt      TEXT NOT NULL,
  allowed_tools      TEXT,
  disallowed_tools   TEXT,
  model              TEXT,
  max_turns          INTEGER,
  skills             TEXT,
  mcp_servers        TEXT,
  hooks              TEXT,
  sub_agent_names    TEXT,
  provider           TEXT,
  tags               TEXT NOT NULL DEFAULT '[]',
  source             TEXT NOT NULL CHECK (source IN ('builtin', 'user')),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_name ON agents(name);

-- workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  repositories     TEXT NOT NULL,
  agent_team       TEXT,
  worktree_enabled INTEGER DEFAULT 0,
  last_accessed_at TEXT NOT NULL,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_workspaces_last_accessed ON workspaces(last_accessed_at DESC);

-- chats
CREATE TABLE IF NOT EXISTS chats (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT NOT NULL,
  worktree_sessions  TEXT,
  title              TEXT NOT NULL,
  primary_agent_id   TEXT NOT NULL,
  team_agent_ids     TEXT NOT NULL,
  expert_sessions    TEXT,
  model              TEXT,
  status             TEXT NOT NULL CHECK (status IN ('running', 'idle', 'stopped', 'merged')),
  total_cost         REAL,
  total_tokens       TEXT,
  total_tool_calls   INTEGER,
  participant_agents TEXT,
  archived_at        INTEGER,
  pinned_at          INTEGER,
  created_at         TEXT NOT NULL,
  last_message_at    TEXT NOT NULL,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chats_workspace ON chats(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_at DESC);

-- execution_logs
CREATE TABLE IF NOT EXISTS execution_logs (
  id            TEXT PRIMARY KEY,
  chat_id       TEXT NOT NULL,
  workspace_id  TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  total_cost    REAL,
  total_tokens  TEXT,
  tool_calls    INTEGER NOT NULL DEFAULT 0,
  duration      INTEGER,
  status        TEXT NOT NULL CHECK (status IN ('running', 'completed', 'error')),
  started_at    TEXT NOT NULL,
  completed_at  TEXT,
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_exec_logs_chat ON execution_logs(chat_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_workspace ON execution_logs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_started ON execution_logs(started_at);

-- cron_jobs
CREATE TABLE IF NOT EXISTS cron_jobs (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  description       TEXT,
  workspace_id      TEXT NOT NULL,
  agent_id          TEXT,
  model             TEXT,
  trigger           TEXT NOT NULL,
  prompt            TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 1,
  retry_on_failure  INTEGER NOT NULL DEFAULT 1,
  max_retries       INTEGER NOT NULL DEFAULT 2,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_run_at       TEXT,
  next_run_at       TEXT,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);

-- cron_job_executions
CREATE TABLE IF NOT EXISTS cron_job_executions (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  status        TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  chat_id       TEXT,
  exit_code     INTEGER,
  error_message TEXT,
  FOREIGN KEY (job_id) REFERENCES cron_jobs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cron_exec_job ON cron_job_executions(job_id);

-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  link        TEXT,
  meta        TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
`

let _db: BetterSqlite3.Database | null = null

export function getDatabase(): BetterSqlite3.Database {
  if (_db) return _db

  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true })
  }

  log.info('Initializing database', { path: DB_PATH })
  try {
    _db = new BetterSqlite3(DB_PATH)
    log.info('Database connection established')
  } catch (err) {
    log.error('Failed to connect database', { error: err instanceof Error ? err.message : String(err) })
    throw err
  }

  _db.pragma('journal_mode = WAL')
  _db.pragma('foreign_keys = ON')
  _db.pragma('synchronous = NORMAL')

  // Initialize Schema V1
  _db.exec(SCHEMA_V1)

  runMigrations(_db)

  return _db
}

export function closeDatabase(): void {
  if (_db) {
    _db.close()
    _db = null
  }
}
