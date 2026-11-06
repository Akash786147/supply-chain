# DepGuard AI — Project Features and Scope

## Project overview

DepGuard AI analyzes software dependencies in a source repository and presents supply-chain risk information in one place. It combines package metadata, security advisories, dependency relationships, and anomaly detection to help a reviewer identify packages that may need attention.

## Initial project features

- **Repository analysis:** Add a public Git repository and select a branch for analysis.
- **Dependency inventory:** Extract npm dependencies and basic Python dependencies from `requirements.txt`.
- **Package health signals:** Review package age, update recency, deprecation, maintainer information when available, repository and license metadata, and version lag.
- **Risk assessment:** Calculate package and project risk scores from the available package signals.
- **Dependency exploration:** View package relationships as an interactive dependency tree and network graph.
- **Anomaly detection:** Use an Isolation Forest model to highlight unusual packages and graph measures such as PageRank, centrality, and blast radius to describe dependency relationships.
- **Scan tracking:** Review scan stages, pipeline outcomes, commit information, and scan history.
- **Data exploration:** Browse analysis features, risk distributions, and correlations, and export dataset rows as CSV or JSON.
- **Project dashboard:** See registered repositories, scan status, risk levels, and aggregate scan information.

## New capabilities and project improvements

| New capability | What it adds | How it improves the project |
| --- | --- | --- |
| Live scan progress | Scan stages, status changes, and project updates stream to the interface using Server-Sent Events. | Keeps pipeline, dashboard, risk, ML, and history views aligned with the latest scan state. |
| Persistent scan records | Projects and pipeline runs have local persistence; scan snapshots can also be stored in PostgreSQL. | Preserves scan context across backend restarts and links results to a specific pipeline and source commit. |
| CycloneDX SBOM | Each scan produces a downloadable CycloneDX 1.6 Software Bill of Materials. | Provides a portable inventory of the analyzed packages and their dependency relationships. |
| Vulnerability evidence | OSV is queried for pinned npm and PyPI package versions; matching advisories are attached to package findings and the SBOM. | Adds version-specific security evidence and references to external advisory records. |
| Better anomaly explanations | Flagged packages include hints about unusual attributes; the interface no longer presents feature spread as model-derived importance. | Makes anomaly results easier to interpret without overstating what the unsupervised model can explain. |
| ML evaluation context | The results report sample and anomaly counts and state that labelled ground truth is unavailable. | Helps reviewers distinguish exploratory anomaly signals from measured predictive performance. |
| Audit trail | Project actions, scan stages, outcomes, decisions, and dataset exports are recorded in a hash-linked journal, with a PostgreSQL copy supported by included migrations. | Makes scan activity traceable and helps detect changes to recorded events. |
| Synchronized interface | API errors are surfaced consistently, missing package metadata remains unknown, and the interface uses a responsive dashboard layout. | Presents evidence more clearly and avoids filling gaps with fabricated values. |

## Remaining planned scope

### 1. Isolate scan execution

- Run each repository analysis in a short-lived Docker container with least privilege, resource and time limits, restricted writable paths, and cleanup after the scan.
- Keep each scan’s checkout and generated evidence isolated from other scans.
- Document a reproducible local deployment, including the API, interface, database, and scanner.

### 2. Monitor scanner network activity

- Establish an allowlist for expected source-control, package-registry, and advisory-service traffic.
- Capture destination, port, protocol, timestamp, and scan identity for scanner connections.
- Surface unexpected destinations and provide evidence for a reviewer to assess.
- Demonstrate the monitor with controlled expected and unexpected connections.

The first monitoring target is the isolated scanner. Monitoring a deployed application service at runtime would require a separate feature that launches and observes the analyzed application.

### 3. Evaluate and extend AI/ML analysis

- Build a reviewed set of normal and suspicious package examples.
- Measure detection quality, including suitable precision, recall, and false-positive metrics.
- Expand explanations to include evidence, score contribution, and a suggested review action.
- Continue to present anomaly detection as a prioritization aid rather than proof of malicious behavior.

### 4. Broaden ecosystem coverage

- Add Python lockfile-aware dependency resolution, including extras and environment markers.
- Expand package metadata and advisory coverage across supported ecosystems.
- Compare dependency inventories and advisory matches with manually reviewed repositories.

### 5. Complete audit and automation workflows

- Apply the included PostgreSQL migrations where database-backed audit and scan snapshots are required.
- Add authenticated user identities, searchable audit history, and audit export.
- Consider remote immutable storage or signed snapshots for stronger audit protection.
- Verify GitHub webhook signatures and connect accepted push events to scans with commit identity.

## Suggested delivery order

1. **Core scan records and live progress** — keep scan status, stages, commit identity, and saved results aligned.
2. **SBOM, advisory evidence, and ML context** — provide package inventory and explainable evidence with clear evaluation limits.
3. **Audit trail** — preserve project, scan, and decision events and support database-backed records.
4. **Container isolation and network monitoring** — control scan execution and observe its outbound connections.
5. **Evaluation and integration** — validate the model, broaden ecosystem support, and complete verified webhook automation.

## Project statement

> DepGuard AI provides a dashboard for examining software supply-chain risk in repository dependencies. It inventories packages, evaluates package health signals, checks pinned versions against vulnerability advisories, generates a CycloneDX SBOM, and uses graph analysis and unsupervised anomaly detection to help prioritize review. The next project stage will evaluate the model against reviewed examples, expand Python dependency support, and isolate scans in containers with monitored outbound network access.

## Design reference

The dashboard layout draws on 21st.dev dashboard and sidebar patterns, adapted to the project’s existing React and CSS stack: [21st.dev dashboard components](https://21st.dev/community/components/explore/dashboard-ui-design).
