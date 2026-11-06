# Project Scope and Future Development Plan

## Project overview

**Working title:** DepGuard AI — Supply Chain Dependency Risk Analysis and Monitoring

The project aims to help developers understand and investigate risks in the software dependencies used by a repository. A user can add a repository for analysis, inspect its dependency tree and risk indicators, and review anomaly analysis through a web dashboard. The proposed next stage extends this into a more reliable, auditable, and isolated analysis platform.

## Current implementation

The repository currently contains a React/TypeScript frontend and a Node.js/Express backend.

### Frontend

- Project dashboard with repository import, project status, and global scan statistics.
- Project pipeline view and manual scan action.
- Dependency tree and dependency graph visualizations.
- Risk signal and risk summary pages.
- ML analysis page with charts, feature matrix information, and flagged anomalies.
- Scan history and dataset browser, including CSV/JSON export options.
- Frontend API client for project, scan, risk, ML, history, audit, and dataset routes.

### Backend and analysis pipeline

- Express API for projects, scans, dependency data, risk summaries, ML statistics, history, and dataset exports.
- Repository cloning and basic ecosystem detection for npm and Python repositories.
- npm dependency extraction and package metadata lookup from the npm registry.
- Heuristic risk indicators for package age, update recency, deprecation, maintainer count, repository/license metadata, and version lag.
- Python Isolation Forest process for anomaly scoring, with NetworkX graph metrics such as PageRank, centrality, and blast radius.
- Optional PostgreSQL/Supabase persistence through Drizzle ORM, plus local scan result files and an in-memory fallback.
- Pipeline runs are now stored locally across backend restarts, and scan stages report measured durations and actual success/failure states.
- A local JSON Lines audit journal records project creation/deletion, scan lifecycle and stage results, and dataset exports. Audit events are available through the backend API and the project's scan-history page.
- Dataset calculations and CSV/JSON export support.

### Important implementation limits

These limits should be stated accurately in a presentation: the existing work is a prototype and some UI and API behavior is still backed by sample data or simplified logic.

- The backend still includes seeded example projects, dependency trees, and risk signals when running without a database. Pipeline records now describe real analyzer stages instead of synthetic success statuses and random durations.
- Database-backed scan history depends on database configuration. Without a database, project records remain in memory, while successful scan summaries, pipeline runs, and audit events are kept in local files.
- The audit journal is append-only through the application interface, but it is not tamper-proof: there is no authentication, verified user identity, signed record chain, or protected remote storage yet.
- The scanner creates a local working directory named `container/`, but it does not run scans inside Docker containers. npm installation uses `--ignore-scripts`, which reduces lifecycle-script execution risk, but does not provide container isolation.
- Risk scoring currently relies on package metadata heuristics. A live vulnerability/advisory feed and actual SBOM generation are not implemented, even though some UI labels suggest those capabilities.
- Python detection exists, but parsing is limited: the current parser reads `requirements.txt`, and the metadata lookup path is npm-specific. Python ecosystem coverage is therefore incomplete.
- Isolation Forest anomaly scoring is implemented, but its output is exploratory. The displayed feature-importance values are variance-based approximations, not explanations produced by the Isolation Forest model. An anomaly is a lead for review, not proof that a package is malicious.
- The GitHub webhook endpoint logs push events but does not yet launch a scan.
- The frontend API URL and backend port can be configured through the frontend and backend `.env.example` files; production deployment configuration still needs to be documented.

## Proposed advanced scope

### 1. Improve AI/ML risk detection

Develop a defensible risk analysis layer that combines explainable package signals with anomaly detection.

- Improve the input features using package metadata, dependency graph position, known security advisories, release behavior, and maintainer/ownership changes where data is available.
- Keep deterministic security checks (for example, a known vulnerable version) separate from statistical anomaly scores.
- Add explanations for each finding: the observed signal, supporting evidence, score contribution, and recommended next step.
- Evaluate the Isolation Forest against a curated set of normal and suspicious package examples. Record precision/recall or other suitable measures, false positives, and data limitations.
- Replace the variance-based “feature importance” label with an appropriate explanation method, or rename it so it does not imply model-derived importance.
- Present results as risk indicators requiring human review; do not label an ML outlier as confirmed malware.

### 2. Add a real audit trail

Add a durable record of analysis activity so users can see what happened, when it happened, and what evidence supported a decision.

- Record scan creation, requesting user or system trigger, repository URL, branch and commit hash, start/end times, scanner/model version, and completion status.
- Preserve scan results and findings with evidence, risk score, decision, and any subsequent review or override.
- Record administrative actions such as project creation/deletion, scan reruns, exports, and changes to risk thresholds.
- Provide searchable project-level history and exportable audit records.
- Protect audit history from silent modification through append-only storage permissions and, if practical for the project, hash-chained records or signed snapshots.
- Clearly distinguish an audit trail from ordinary application logs: logs help diagnose operation; audit records provide a durable account of security-relevant actions and decisions.

### 3. Containerize and isolate repository scanning

Run each untrusted repository analysis in a dedicated, short-lived container rather than directly on the backend host.

- Package the scanner and its required runtime dependencies reproducibly.
- Use least privilege, resource/time limits, restricted writable paths, and cleanup after scans.
- Keep repository contents and generated artifacts separated by scan/project.
- Avoid privileged containers and unnecessary host mounts; document the remaining risks of analyzing untrusted code.
- Make the frontend, API, database, and scanner configuration reproducible for local demonstration, for example with a documented Compose setup.

### 4. Prototype outbound network monitoring

Monitor network activity generated by the isolated scanner and flag connections outside an expected policy.

- Define expected destinations for source control and package metadata/registries.
- Capture connection metadata such as timestamp, destination, port, protocol, and the scan/container responsible.
- Alert on unexpected destinations or unusual connection patterns and show the evidence in the dashboard or scan report.
- Demonstrate detection with controlled scenarios and report both detections and false positives.
- Scope the first version to scanner containers. The current platform does not deploy or run the analyzed repository’s application services, so it cannot yet claim to monitor those services at runtime. Running target applications would require a separate, more isolated execution feature.

### 5. Strengthen supply chain evidence and automation

- Generate a machine-readable SBOM for each scan and preserve it with the scan record.
- Integrate a vulnerability/advisory source and map affected package versions to findings.
- Complete one ecosystem end to end first (recommended: npm), then add Python support with the correct package metadata source and dependency resolver.
- Connect verified GitHub push events to scan jobs, including webhook authentication and commit identity.
- Replace mock pipeline records with real per-stage status, timing, error details, and scan decisions.

### 6. Integration, usability, and evaluation

- Configure API endpoints and database settings through environment variables.
- Align API errors and status responses with the frontend; add clear loading, failure, and retry states.
- Run end-to-end demonstrations on a small, documented set of repositories.
- Compare findings against known package advisories and manually reviewed examples.
- Document architecture, setup, supported ecosystems, data sources, limitations, and responsible interpretation of risk scores.

## Suggested delivery sequence

| Stage | Main work | Demonstrable result | Status |
| --- | --- | --- | --- |
| 1. Stabilize the core | Replace synthetic pipeline steps with measured analyzer stages; prevent overlapping scans; persist pipeline runs; record the actual commit and interrupted scans | Pipeline history reflects real scan progress and survives backend restarts | Implemented in this tranche; projects still need the configured database for durable project records |
| 2. Strengthen analysis | Add SBOM and vulnerability evidence for npm; validate and explain risk/ML output | Findings include reproducible evidence and measured model limitations | Proposed |
| 3. Add auditability | Record project actions, scan lifecycle/stages/results, and dataset exports; display events in scan history | A reviewer can trace a scan result to its project, commit, stages, and decision | Initial local journal implemented; authenticated identities, remote protected storage, and tamper evidence remain proposed |
| 4. Isolate and monitor | Containerize scans and add outbound network metadata monitoring | A controlled demo shows expected and unexpected scanner connections | Proposed |
| 5. Integrate and evaluate | Connect verified webhook triggers, improve frontend/API integration, document and evaluate | Reproducible end-to-end project demo and final evaluation report | Proposed |

The core pipeline reliability and an initial local audit journal are implemented. Remaining stages include stronger SBOM/vulnerability evidence, more complete ML evaluation and explanation, a protected audit store, container/network isolation, and verified webhook-triggered scans.

The initial audit journal records trigger categories such as `user` or `system`, not authenticated identities. It is suitable for a project prototype, but must not be presented as tamper-proof or as a complete production audit system.

## Proposed evaluation criteria

- A scan can be reproduced for a repository commit, and its status and duration match what actually happened.
- Dependency counts, SBOM contents, and vulnerability findings can be traced to their data sources.
- ML performance is reported against reviewed examples, including false positives and known limitations.
- Audit records identify the project, commit, scan time, scanner/model version, findings, and decision, and are not silently overwritten.
- The container/network demonstration identifies expected versus unexpected destinations and records enough evidence for a human to review the alert.
- Setup instructions allow another team member or the professor to run the demo from a clean checkout with the required configuration.

## Short project statement for a proposal

> We have developed a web dashboard and backend prototype that analyzes repository dependencies using package metadata, heuristic risk indicators, dependency graph metrics, and Isolation Forest anomaly detection. We propose to make the scan pipeline and results reliable, add SBOM and vulnerability evidence, improve explainability and evaluation of the AI/ML risk signals, and introduce a durable audit trail for scans and decisions. As an advanced security extension, we will isolate scan jobs in containers and monitor their outbound network activity for unexpected connections. The initial monitoring scope is the scanner environment; monitoring deployed application services would require a separate runtime deployment feature.

## Repository layout note

The current checkout has separate `frontend/` and `backend/` directories, each with its own Git metadata. The frontend README remains the default Vite template, while backend setup and architecture documentation should be added before handoff so the project can be run consistently by others.
