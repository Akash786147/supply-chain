CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  project_id integer,
  pipeline_id integer,
  action text NOT NULL,
  actor text NOT NULL,
  previous_hash text NOT NULL,
  event_hash text NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS audit_events_project_time_idx
  ON audit_events (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_events_pipeline_idx
  ON audit_events (pipeline_id);

NOTIFY pgrst, 'reload schema';
