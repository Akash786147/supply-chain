import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchRiskSummary, fetchRiskSignals, subscribeToUpdates } from "../api";
import type { RiskSummary, RiskSignal } from "../types";

const priority: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export default function RiskAnalysis() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [summary, setSummary] = useState<RiskSummary | null>(null);
  const [signals, setSignals] = useState<RiskSignal[]>([]);
  const [showContext, setShowContext] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      fetchRiskSummary(projectId).then((value) => { setSummary(value); setError(null); })
        .catch(() => { setSummary(null); setError("No scan results are available. Run a scan to populate this view."); });
      fetchRiskSignals(projectId).then(setSignals).catch(() => setSignals([]));
    };
    refresh();
    return subscribeToUpdates((update) => {
      if (update.type === "connection" && update.status === "connected") refresh();
      else if (update.projectId === projectId) refresh();
    });
  }, [projectId]);

  const attention = useMemo(() => signals.filter((signal) => ["critical", "high", "medium"].includes(signal.severity)), [signals]);
  const grouped = useMemo(() => {
    const groups = new Map<string, RiskSignal[]>();
    for (const signal of attention) {
      const root = signal.rootDependency || signal.package;
      groups.set(root, [...(groups.get(root) || []), signal]);
    }
    return [...groups.entries()].map(([root, findings]) => ({
      root,
      findings: findings.sort((a, b) => (priority[b.severity] || 0) - (priority[a.severity] || 0)),
      severity: findings.reduce((highest, item) => priority[item.severity] > priority[highest] ? item.severity : highest, "medium"),
      packages: [...new Set(findings.map((item) => `${item.package}${item.packageVersion ? `@${item.packageVersion}` : ""}`))],
    })).sort((a, b) => priority[b.severity] - priority[a.severity]);
  }, [attention]);

  if (!summary) return <div className="page">{error ? <div className="empty-state"><h2>Risk data unavailable</h2><p className="muted">{error}</p><Link to={`/project/${projectId}`} className="btn btn-primary">Go to project</Link></div> : <><div className="loading-spinner" />Loading risk analysis...</>}</div>;

  const severityColor = (severity: string) => severity === "critical" || severity === "high" ? "var(--red)" : severity === "medium" ? "var(--yellow)" : "var(--muted)";
  const context = signals.filter((signal) => signal.severity === "info");
  const lowerPriority = signals.filter((signal) => signal.severity === "low" || signal.severity === "unknown");

  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{summary.projectName}</Link> / <span>Security Findings</span></div>
      <div className="page-header">
        <div><h1>Security Findings</h1><p className="muted">Only advisory and source-code findings affect the attention list. Package age and missing metadata are context, not proof of a vulnerability.</p></div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/project/${projectId}/sbom`} className="btn">View SBOM</Link>
          <Link to={`/project/${projectId}/ml`} className="btn">ML outliers</Link>
        </div>
      </div>

      <div className="risk-overview">
        <div className="card stat-card"><div className="stat-value">{summary.totalDependencies}</div><div className="stat-label">Dependencies scanned</div></div>
        <div className="card stat-card"><div className="stat-value">{attention.length}</div><div className="stat-label">Findings needing review</div></div>
        <div className="card stat-card"><div className="stat-value">{summary.signalCounts.critical + summary.signalCounts.high}</div><div className="stat-label">High or critical findings</div></div>
        <div className="card stat-card"><div className="stat-value">{summary.sourceFindingCount ?? signals.filter((signal) => signal.source?.startsWith("Static source-code rule")).length}</div><div className="stat-label">Code findings</div></div>
      </div>
      <p className="muted">Source checks scanned {summary.sourceFilesScanned ?? 0} files. Dependency advisory lookup status: {summary.vulnerabilityScanStatus || "unknown"}.</p>

      <section style={{ marginTop: 26 }}>
        <h2>Attention groups</h2>
        <p className="muted">Transitive packages are grouped under the direct dependency that brings them in, so one underlying issue is easier to assess.</p>
        {grouped.length === 0 ? (
          <div className="card" style={{ marginTop: 14 }}><h3>No medium, high, or critical findings</h3><p className="muted">This scan found no findings in the attention range. That does not mean every package or source-code path has been proven safe.</p></div>
        ) : (
          <div className="pipeline-list" style={{ marginTop: 14 }}>
            {grouped.map((group) => (
              <article className="card" key={group.root}>
                <div className="pipeline-header">
                  <div><h3 style={{ margin: 0 }}>{group.root}</h3><span className="muted">{group.packages.length} affected {group.packages.length === 1 ? "package" : "packages"} · highest severity {group.severity}</span></div>
                  <span className="badge" style={{ color: severityColor(group.severity), borderColor: severityColor(group.severity) }}>{group.findings.length} findings</span>
                </div>
                <div className="signals-table" style={{ marginTop: 12 }}>
                  {group.findings.map((finding, index) => (
                    <div className="signals-table-row" key={`${finding.signal}-${finding.package}-${index}`}>
                      <span className="signal-package">{finding.package}</span>
                      <span className="signal-name">{finding.signal}</span>
                      <span style={{ color: severityColor(finding.severity), textTransform: "capitalize" }}>{finding.severity}</span>
                      <span className="signal-desc">{finding.description}{finding.snippet && <code className="finding-snippet">{finding.snippet}</code>}{finding.source && <small className="evidence-source">{finding.source}</small>}{finding.references?.[0] && <a className="evidence-link" href={finding.references[0]} target="_blank" rel="noreferrer">Evidence ↗</a>}</span>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {lowerPriority.length > 0 && <details style={{ marginTop: 24 }}>
        <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>Low or unscored advisories ({lowerPriority.length}) — lower priority, but still review</summary>
        <div className="card" style={{ marginTop: 12 }}>
          {lowerPriority.map((item, index) => <p key={`${item.package}-${item.signal}-${index}`}><strong>{item.package}{item.packageVersion ? `@${item.packageVersion}` : ""}</strong> · {item.signal} · {item.severity}: {item.description}{item.references?.[0] && <> <a className="evidence-link" href={item.references[0]} target="_blank" rel="noreferrer">Evidence ↗</a></>}</p>)}
        </div>
      </details>}

      {context.length > 0 && <details style={{ marginTop: 24 }} open={showContext} onToggle={(event) => setShowContext(event.currentTarget.open)}>
        <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>Package context ({context.length}) — informational; does not raise the security risk score</summary>
        <div className="card" style={{ marginTop: 12 }}>
          {context.map((item, index) => <p key={`${item.package}-${item.signal}-${index}`} className="muted"><strong>{item.package}</strong>: {item.description}</p>)}
        </div>
      </details>}
    </div>
  );
}
