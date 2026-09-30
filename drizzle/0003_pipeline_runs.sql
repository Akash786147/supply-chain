CREATE TABLE IF NOT EXISTS pipeline_runs (
  id integer PRIMARY KEY,
  project_id integer NOT NULL,
  trigger text NOT NULL,
  branch text,
  commit_hash text,
  status text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_summary jsonb,
  decision text,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  error text,
  pipeline_data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pipeline_runs_project_time_idx
  ON pipeline_runs (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS pipeline_runs_status_idx
  ON pipeline_runs (status);

NOTIFY pgrst, 'reload schema';
