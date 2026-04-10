import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchRiskSummary, fetchRiskSignals } from "../api";
import type { RiskSummary, RiskSignal } from "../types";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

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

  if (!summary) return <div className="page"><div className="loading-spinner" />Loading risk analysis...</div>;

  const filtered = filterSeverity === "all" ? signals : signals.filter((s) => s.severity === filterSeverity);

  const severityColor = (s: string) => {
    if (s === "critical") return "var(--red)";
    if (s === "high") return "#f97316";
    if (s === "medium") return "var(--yellow)";
    return "var(--muted)";
  };

  const riskColor = (level: string) => {
    if (level === "critical" || level === "high") return "var(--red)";
    if (level === "medium") return "var(--yellow)";
    if (level === "low") return "var(--green)";
    return "var(--muted)";
  };

  // Mini chart data for signal distribution
  const signalTypes = new Map<string, number>();
  signals.forEach((s) => {
    signalTypes.set(s.signal, (signalTypes.get(s.signal) || 0) + 1);
  });
  const signalChartData = Array.from(signalTypes.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{summary.projectName}</Link> /{" "}
        <span>Risk Analysis</span>
      </div>

      <div className="page-header">
        <h1>⚠ Risk Analysis</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/project/${projectId}/ml`} className="btn">🧠 ML Analysis</Link>
          <Link to={`/project/${projectId}/tree`} className="btn">🌲 Dep Tree</Link>
        </div>
      </div>

      {/* Overview cards */}
      <div className="risk-overview">
        <div className="card risk-score-card glass-card">
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
            <span className="severity-dot" style={{ background: "#f97316" }} />
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

      {/* Signal Distribution Mini Chart */}
      {signalChartData.length > 0 && (
        <div className="card" style={{ marginTop: 24 }}>
          <h3>Signal Type Distribution</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={signalChartData}>
              <XAxis dataKey="name" stroke="#666" fontSize={10} angle={-20} textAnchor="end" height={50} />
              <YAxis stroke="#666" fontSize={11} />
              <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#ededed" }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {signalChartData.map((entry, i) => {
                  const c = ["deprecated", "known-vulnerability"].includes(entry.name) ? "#ef4444"
                    : ["unmaintained", "no-repository"].includes(entry.name) ? "#f97316"
                    : ["outdated", "few-maintainers"].includes(entry.name) ? "#eab308"
                    : "#3b82f6";
                  return <Cell key={i} fill={c} fillOpacity={0.8} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

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
              <span className="signal-package">
                {sig.package}
                {sig.isAnomaly && <span className="ml-badge">ML</span>}
              </span>
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
