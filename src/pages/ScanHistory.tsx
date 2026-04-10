import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchScanHistory, fetchProject } from "../api";
import type { ScanHistoryEntry, Project } from "../types";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from "recharts";

export default function ScanHistory() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [history, setHistory] = useState<ScanHistoryEntry[]>([]);
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    fetchScanHistory(projectId).then(setHistory);
    fetchProject(projectId).then(setProject);
  }, [projectId]);

  const chartData = [...history].reverse().map((scan, i) => ({
    scan: `#${i + 1}`,
    riskScore: scan.overallRiskScore || 0,
    deps: scan.totalDeps || 0,
    signals: scan.totalSignals || 0,
    anomalies: scan.totalAnomalies || 0,
    date: new Date(scan.createdAt).toLocaleDateString(),
    duration: ((scan.scanDurationMs || 0) / 1000).toFixed(1),
  }));

  const riskColor = (level: string) => {
    if (level === "critical" || level === "high") return "var(--red)";
    if (level === "medium") return "var(--yellow)";
    if (level === "low") return "var(--green)";
    return "var(--muted)";
  };

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{project?.name || "Project"}</Link> / <span>Scan History</span>
      </div>

      <div className="page-header">
        <h1>📊 Scan History</h1>
        <Link to={`/project/${projectId}`} className="btn">Back to Project</Link>
      </div>

      {history.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">📭</span>
          <h2>No Scan History</h2>
          <p className="muted">Run a scan to start tracking risk trends over time.</p>
          <Link to={`/project/${projectId}`} className="btn btn-primary">Go Back & Run Scan</Link>
        </div>
      ) : (
        <>
          <div className="ml-charts-grid">
            {/* Risk Score Trend */}
            <div className="card chart-card">
              <h3>Risk Score Over Time</h3>
              <p className="muted chart-desc">How the project's overall risk score has changed across scans</p>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="scan" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#ededed" }} />
                  <Area type="monotone" dataKey="riskScore" stroke="#ef4444" fill="url(#riskGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Dependencies & Signals Trend */}
            <div className="card chart-card">
              <h3>Dependencies & Signals Trend</h3>
              <p className="muted chart-desc">Tracking dependency count and risk signals across scans</p>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="scan" stroke="#666" fontSize={11} />
                  <YAxis stroke="#666" fontSize={11} />
                  <Tooltip contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#ededed" }} />
                  <Line type="monotone" dataKey="deps" stroke="#3b82f6" strokeWidth={2} name="Dependencies" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="signals" stroke="#eab308" strokeWidth={2} name="Signals" dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="anomalies" stroke="#ef4444" strokeWidth={2} name="Anomalies" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Scan Table */}
          <div className="card" style={{ marginTop: 24 }}>
            <h3>All Scans</h3>
            <div className="signals-table">
              <div className="signals-table-head history-head">
                <span>Scan</span>
                <span>Date</span>
                <span>Risk Score</span>
                <span>Risk Level</span>
                <span>Dependencies</span>
                <span>Signals</span>
                <span>Anomalies</span>
                <span>Duration</span>
              </div>
              {history.map((scan, i) => (
                <div className="signals-table-row" key={scan.id || i}>
                  <span className="signal-package">#{history.length - i}</span>
                  <span>{new Date(scan.createdAt).toLocaleDateString()}</span>
                  <span style={{ color: riskColor(scan.riskLevel), fontWeight: 700 }}>{Math.round(scan.overallRiskScore)}</span>
                  <span style={{ color: riskColor(scan.riskLevel), textTransform: "uppercase", fontWeight: 600, fontSize: 11 }}>
                    {scan.riskLevel}
                  </span>
                  <span>{scan.totalDeps}</span>
                  <span>{scan.totalSignals}</span>
                  <span style={{ color: scan.totalAnomalies > 0 ? "var(--red)" : "var(--green)" }}>
                    {scan.totalAnomalies}
                  </span>
                  <span className="muted">{((scan.scanDurationMs || 0) / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
