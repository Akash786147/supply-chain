# DepGuard backend notes

The API serves scan progress using Server-Sent Events at `GET /api/events`. The browser can reconnect automatically; pipeline and audit snapshots are also available through the REST routes.

## Supabase HTTPS database setup

The backend uses Supabase's HTTPS Data API, so it does not require a direct PostgreSQL connection from the server. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the backend `.env` file. Keep the service role key on the backend only; it bypasses row-level security.

The tables must be in the Supabase `public` schema and available through the Data API. The backend expects `projects`, `scans`, `scan_packages`, `audit_events`, and `pipeline_runs` with the columns defined in `drizzle/schema.js` and the SQL migrations below. Successful scans store the complete result tree, SBOM, ML statistics, and package records. Every pipeline transition stores its stage statuses and error details, including failed runs; audit events are copied to the database too. Local JSON files remain a fallback and recovery copy. Supabase's HTTPS Data API does not replace Drizzle Studio or Drizzle migrations; those tools still need a PostgreSQL connection.

## GitHub sign-in and private repositories

1. Create a GitHub OAuth App. Set its homepage to `http://localhost:5173` and its callback URL to `http://localhost:3001/api/auth/github/callback`.
2. Copy its client ID and client secret into `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `backend/.env`. Set `GITHUB_CALLBACK_URL` to the callback above and `FRONTEND_URL` to the frontend origin.
3. Restart the backend, open the import form, and choose **Continue with GitHub**. The app requests `read:user` and `repo` access so it can list and clone repositories the user can access.

The OAuth token is kept in the backend process memory and is not written to project records or clone URLs. The browser receives only an HTTP-only session cookie. Sessions last up to eight hours and are cleared when the backend process restarts. The requested `repo` OAuth scope grants broad private-repository access; the analyzer uses it only to list repository metadata and clone the selected branch.

Repository metadata and branch names are loaded from GitHub before import. If the branch is left unspecified by an API client, the backend selects the repository's actual default branch instead of assuming `main`.

## Python ML environment

The ML stage requires Python 3, NumPy, scikit-learn, and NetworkX. From `backend/`, create and populate a local environment:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
```

The analyzer automatically prefers `.venv/bin/python` when it exists. Set `ML_PYTHON` in `backend/.env` if Python is installed at another path. If the ML process exits early, the backend now records the ML-stage failure and continues the scan without ML results instead of crashing with an unhandled `EPIPE`.

## PostgreSQL schema updates

For an existing database, apply the SQL migrations in order from the database SQL console:

1. `drizzle/0001_audit_events.sql`
2. `drizzle/0002_scan_snapshots.sql`
3. `drizzle/0003_pipeline_runs.sql`

The first migration creates the durable audit-event copy. The second stores full scan and SBOM snapshots with scan history. The third stores all pipeline runs and stage logs. Apply all three in the Supabase SQL Editor, then restart the backend. On startup, it copies local pipeline and audit history into the database so existing records are carried over; later changes are written to both stores.

## Scan evidence and limits

- Each successful scan writes a CycloneDX 1.6 SBOM to `data/<project-id>.sbom.json` and exposes it at `/api/projects/<project-id>/sbom`.
- Result files are served only when their pipeline ID matches a persisted successful run. Legacy JSON files without that identity are treated as stale; rerun those projects to regenerate trusted snapshots.
- OSV.dev is queried for pinned npm and PyPI package versions. Advisory lookup failure is recorded in `scanMeta.vulnerabilityScanStatus`; a failed external lookup must not be interpreted as a clean vulnerability result.
- Python registry metadata comes from PyPI. Dependency extraction currently supports basic `requirements.txt` lines only; it is not a full resolver for lockfiles, extras, or environment markers.
- Isolation Forest is unsupervised. Current evaluation fields describe sample count and anomaly rate, not measured accuracy. A reviewed labelled dataset is still needed for precision/recall.
- OSV advisories determine dependency security severity. Deprecation, age, maintainer count, license, and missing metadata stay as informational context and do not independently raise a dependency to high or critical risk.
- The source-code stage applies bounded CWE-oriented pattern checks to first-party source files (for example unsafe dynamic execution, disabled TLS verification, unsafe deserialization, and likely hard-coded credentials). These are review signals, not a CVE database or a substitute for a full SAST engine; results can need human confirmation.
- ML outlier scoring compares at least 20 third-party dependencies using observed registry metadata and graph position. Missing metadata is median-imputed and reported as coverage. Outlier status is not a vulnerability verdict, and no accuracy is claimed without labelled evaluation data.
- The audit journal is hash-linked and append-only through the application. The hash chain detects edits but does not prevent a privileged person from rewriting the whole file. User labels are trigger categories, not authenticated identities.
- `container/` is a checkout directory name, not Docker isolation. Repository contents are cloned into the backend host environment; use only repositories appropriate for the demo until scan isolation is implemented.
