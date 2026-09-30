ALTER TABLE scans ADD COLUMN IF NOT EXISTS pipeline_id integer;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS scan_data jsonb;
ALTER TABLE scans ADD COLUMN IF NOT EXISTS sbom jsonb;

CREATE INDEX IF NOT EXISTS scans_pipeline_idx ON scans (pipeline_id);

NOTIFY pgrst, 'reload schema';
