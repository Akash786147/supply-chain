import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchMLStats } from "../api";
import type { MLStats } from "../types";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, Cell, Legend, ZAxis,
} from "recharts";

export default function MLAnalysis() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [stats, setStats] = useState<MLStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMLStats(projectId)
      .then(setStats)
      .catch(() => setError("No ML data available. Run a scan on a real repository first."));
  }, [projectId]);

  if (error) {
    return (
      <div className="page">
        <div className="breadcrumb">
          <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>Project</Link> / <span>ML Analysis</span>
        </div>
        <div className="empty-state">
          <span className="empty-icon">🧠</span>
          <h2>No ML Data Available</h2>
          <p className="muted">{error}</p>
          <Link to={`/project/${projectId}`} className="btn btn-primary">Go Back & Run Scan</Link>
        </div>
      </div>
    );
  }

  if (!stats) return <div className="page"><div className="loading-spinner" />Loading ML analysis...</div>;

  const anomalies = stats.featureMatrix.filter((f) => f.isAnomaly);
  const normal = stats.featureMatrix.filter((f) => !f.isAnomaly);

  // Feature importance data
  const importanceData = Object.entries(stats.featureImportances).map(([name, value]) => ({
    name: name.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase()),
    value: Math.round(value * 100),
  })).sort((a, b) => b.value - a.value);

  // Correlation heatmap labels
  const featureLabels = stats.featureNames.map((n) =>
    n.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())
  );

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>Project</Link> / <span>ML Analysis</span>
      </div>

      <div className="page-header">
        <h1>🧠 ML Anomaly Detection</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/project/${projectId}/graph`} className="btn">Network Graph</Link>
          <Link to={`/project/${projectId}/tree`} className="btn">Dependency Tree</Link>
        </div>
      </div>

      {/* Summary cards */}
      <div className="ml-summary-row">
        <div className="card ml-stat-card">
          <div className="ml-stat-big">{stats.totalPackages}</div>
          <div className="ml-stat-label">Packages Analyzed</div>
        </div>
        <div className="card ml-stat-card anomaly-card">
          <div className="ml-stat-big" style={{ color: "var(--red)" }}>{stats.totalAnomalies}</div>
          <div className="ml-stat-label">Anomalies Detected</div>
        </div>
        <div className="card ml-stat-card">
          <div className="ml-stat-big">{stats.featureNames.length}</div>
          <div className="ml-stat-label">Features Extracted</div>
        </div>
        <div className="card ml-stat-card">
          <div className="ml-stat-big" style={{ color: "var(--green)" }}>
            {Math.round(((stats.totalPackages - stats.totalAnomalies) / stats.totalPackages) * 100)}%
          </div>
          <div className="ml-stat-label">Safe Packages</div>
        </div>
      </div>

      <div className="ml-charts-grid">
        {/* Risk Score Distribution */}
        <div className="card chart-card">
          <h3>Risk Score Distribution</h3>
          <p className="muted chart-desc">Histogram showing the distribution of risk scores across all packages</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.riskDistribution}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="bin" stroke="#666" fontSize={11} />
              <YAxis stroke="#666" fontSize={11} />
              <Tooltip
                contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#ededed" }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {stats.riskDistribution.map((entry, i) => {
                  const val = parseInt(entry.bin.split("-")[0]);
                  const color = val > 60 ? "#ef4444" : val > 40 ? "#f97316" : val > 20 ? "#eab308" : "#22c55e";
                  return <Cell key={i} fill={color} fillOpacity={0.8} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Feature Importance */}
        <div className="card chart-card">
          <h3>Feature Importance</h3>
          <p className="muted chart-desc">Which features the Isolation Forest relied on most for anomaly scoring</p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={importanceData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis type="number" stroke="#666" fontSize={11} domain={[0, 'auto']}
                tickFormatter={(v: number) => `${v}%`}
              />
              <YAxis type="category" dataKey="name" stroke="#666" fontSize={11} width={120} />
              <Tooltip
                contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#ededed" }}
                formatter={(value: number) => [`${value}%`, "Importance"]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} fill="#3b82f6" fillOpacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Scatter: Age vs Maintainers */}
        <div className="card chart-card">
          <h3>Package Age vs Maintainer Count</h3>
          <p className="muted chart-desc">Red dots indicate ML-flagged anomalies — suspicious outliers in the metadata space</p>
          <ResponsiveContainer width="100%" height={300}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis type="number" dataKey="ageDays" name="Age (days)" stroke="#666" fontSize={11} />
              <YAxis type="number" dataKey="maintainerCount" name="Maintainers" stroke="#666" fontSize={11} />
              <ZAxis type="number" dataKey="riskScore" range={[30, 200]} name="Risk Score" />
              <Tooltip
                contentStyle={{ background: "#141414", border: "1px solid #262626", borderRadius: 8, color: "#ededed" }}
                formatter={(value: number, name: string) => [value, name]}
                labelFormatter={() => ""}
              />
              <Legend />
              <Scatter name="Normal" data={normal} fill="#22c55e" fillOpacity={0.6} />
              <Scatter name="Anomaly" data={anomalies} fill="#ef4444" fillOpacity={0.9} />
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Correlation Heatmap */}
        <div className="card chart-card">
          <h3>Feature Correlation Heatmap</h3>
          <p className="muted chart-desc">Pearson correlation between extracted features — darker = stronger relationship</p>
          <div className="heatmap-container">
            <div className="heatmap-row">
              <div className="heatmap-labels-y">
                {featureLabels.map((l, i) => (
                  <div key={`y-${i}`} className="heatmap-label">{l}</div>
                ))}
              </div>
              <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${featureLabels.length}, 1fr)` }}>
                {stats.correlationMatrix.map((row, i) =>
                  row.map((val, j) => {
                    const abs = Math.abs(val);
                    const color = val > 0
                      ? `rgba(59, 130, 246, ${abs * 0.9})`
                      : `rgba(239, 68, 68, ${abs * 0.9})`;
                    return (
                      <div
                        key={`${i}-${j}`}
                        className="heatmap-cell"
                        style={{ background: color }}
                        title={`${featureLabels[i]} × ${featureLabels[j]}: ${val.toFixed(2)}`}
                      >
                        <span className="heatmap-val">{abs > 0.3 ? val.toFixed(1) : ""}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
            <div className="heatmap-labels-x" style={{ marginLeft: 108 }}>
              {featureLabels.map((l, i) => (
                <div key={`x-${i}`} className="heatmap-label-x">{l}</div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Anomalies Table */}
      <div className="card" style={{ marginTop: 24 }}>
        <h3>🚨 Flagged Anomalies — Isolation Forest Results</h3>
        <p className="muted" style={{ marginBottom: 16 }}>
          Packages flagged as statistical outliers based on metadata features and graph topology
        </p>
        {anomalies.length === 0 ? (
          <div className="signals-empty">✓ No anomalies detected — all packages appear normal</div>
        ) : (
          <div className="signals-table">
            <div className="signals-table-head anomaly-head">
              <span>Package</span>
              <span>Anomaly Score</span>
              <span>Risk Score</span>
              <span>Maintainers</span>
              <span>Age (days)</span>
              <span>Depth</span>
              <span>PageRank</span>
            </div>
            {anomalies
              .sort((a, b) => b.anomalyScore - a.anomalyScore)
              .map((a, i) => (
                <div className="signals-table-row anomaly-row" key={i}>
                  <span className="signal-package">{a.name}@{a.version}</span>
                  <span style={{ color: "var(--red)", fontWeight: 700 }}>{(a.anomalyScore * 100).toFixed(1)}%</span>
                  <span style={{ color: a.riskScore > 40 ? "var(--red)" : a.riskScore > 20 ? "var(--yellow)" : "var(--green)" }}>
                    {a.riskScore}
                  </span>
                  <span>{a.maintainerCount}</span>
                  <span>{a.ageDays}</span>
                  <span>{a.depth}</span>
                  <span>{a.pagerank.toFixed(4)}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
