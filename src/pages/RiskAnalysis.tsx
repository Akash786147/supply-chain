import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchRiskSummary, fetchRiskSignals } from "../api";
import type { RiskSummary, RiskSignal } from "../types";

export default function RiskAnalysis() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [summary, setSummary] = useState<RiskSummary | null>(null);
  const [signals, setSignals] = useState<RiskSignal[]>([]);
  const [filterSeverity, setFilterSeverity] = useState<string>("all");

  useEffect(() => {
    fetchRiskSummary(projectId).then(setSummary);
    fetchRiskSignals(projectId).then(setSignals);
  }, [projectId]);

  if (!summary) return <div className="page">Loading risk analysis...</div>;

  const filtered = filterSeverity === "all" ? signals : signals.filter((s) => s.severity === filterSeverity);

  const severityColor = (s: string) => {
    if (s === "critical") return "var(--red)";
    if (s === "high") return "var(--red)";
    if (s === "medium") return "var(--yellow)";
    return "var(--muted)";
  };

  const riskColor = (level: string) => {
    if (level === "critical" || level === "high") return "var(--red)";
    if (level === "medium") return "var(--yellow)";
    if (level === "low") return "var(--green)";
    return "var(--muted)";
  };

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{summary.projectName}</Link> /{" "}
        <span>Risk Analysis</span>
      </div>

      <div className="page-header">
        <h1>Risk Analysis</h1>
        <Link to={`/project/${projectId}/tree`} className="btn">
          View Dependency Tree
        </Link>
      </div>

      {/* Overview cards */}
      <div className="risk-overview">
        <div className="card risk-score-card">
          <div className="risk-score-big" style={{ color: riskColor(summary.overallRiskLevel) }}>
            {summary.overallRiskScore}
          </div>
          <div className="risk-score-label">Overall Risk Score</div>
          <div className="risk-level-label" style={{ color: riskColor(summary.overallRiskLevel) }}>
            {summary.overallRiskLevel.toUpperCase()}
          </div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{summary.totalDependencies}</div>
          <div className="stat-label">Total Dependencies</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{summary.totalSignals}</div>
          <div className="stat-label">Risk Signals Found</div>
        </div>
        <div className="card stat-card severity-card">
          <div className="severity-row">
            <span className="severity-dot" style={{ background: "var(--red)" }} />
            <span>Critical: {summary.signalCounts.critical}</span>
          </div>
          <div className="severity-row">
            <span className="severity-dot" style={{ background: "var(--red)" }} />
            <span>High: {summary.signalCounts.high}</span>
          </div>
          <div className="severity-row">
            <span className="severity-dot" style={{ background: "var(--yellow)" }} />
            <span>Medium: {summary.signalCounts.medium}</span>
          </div>
          <div className="severity-row">
            <span className="severity-dot" style={{ background: "var(--green)" }} />
            <span>Low: {summary.signalCounts.low}</span>
          </div>
        </div>
      </div>

      {/* Signals table */}
      <div style={{ marginTop: 24 }}>
        <div className="signals-header">
          <h2>Risk Signals</h2>
          <div className="filter-btns">
            {["all", "critical", "high", "medium", "low"].map((sev) => (
              <button
                key={sev}
                className={`btn btn-sm ${filterSeverity === sev ? "btn-primary" : ""}`}
                onClick={() => setFilterSeverity(sev)}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        <div className="signals-table">
          <div className="signals-table-head">
            <span>Package</span>
            <span>Signal</span>
            <span>Severity</span>
            <span>Description</span>
          </div>
          {filtered.map((sig, i) => (
            <div className="signals-table-row" key={i}>
              <span className="signal-package">{sig.package}</span>
              <span className="signal-name">{sig.signal}</span>
              <span className="signal-severity" style={{ color: severityColor(sig.severity) }}>
                {sig.severity}
              </span>
              <span className="signal-desc">{sig.description}</span>
            </div>
          ))}
          {filtered.length === 0 && <div className="signals-empty">No signals for this filter.</div>}
        </div>
      </div>
    </div>
  );
}
