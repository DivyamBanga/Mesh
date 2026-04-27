CREATE TABLE IF NOT EXISTS sessions (
  session_id     TEXT PRIMARY KEY,
  developer_name TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  branch         TEXT NOT NULL,
  connected_at   INTEGER NOT NULL,
  last_seen      INTEGER NOT NULL,
  ws_connected   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  event_id      TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  developer     TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  delivered_to  TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS file_locks (
  path        TEXT NOT NULL,
  project_id  TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  developer   TEXT NOT NULL,
  locked_at   INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  PRIMARY KEY (path, project_id)
);

CREATE TABLE IF NOT EXISTS decisions (
  decision_id  TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  session_id   TEXT NOT NULL,
  developer    TEXT NOT NULL,
  category     TEXT NOT NULL,
  summary      TEXT NOT NULL,
  rationale    TEXT NOT NULL,
  affected     TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_project_id ON events (project_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events (created_at);
CREATE INDEX IF NOT EXISTS idx_events_session_id ON events (session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions (project_id);
CREATE INDEX IF NOT EXISTS idx_decisions_project_id ON decisions (project_id);
