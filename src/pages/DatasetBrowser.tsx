import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchDataset, fetchDatasetStats, fetchCorrelationMatrix, exportDataset } from "../api";
import type { FeatureRow } from "../types";

interface DatasetStats {
  total_packages: number;
  total_anomalies: number;
  anomaly_percentage: number;
  anomaly_score_mean: number;
  anomaly_score_std: number;
  anomaly_score_min: number;
  anomaly_score_max: number;
  avg_package_age_days: number;
  avg_maintainer_count: number;
  top_anomalies?: FeatureRow[];
}

interface RiskBin {
  bin: string;
  count: number;
}

export default function DatasetBrowser() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);

  const [dataset, setDataset] = useState<FeatureRow[]>([]);
  const [stats, setStats] = useState<DatasetStats | null>(null);
  const [riskDistribution, setRiskDistribution] = useState<RiskBin[]>([]);
  const [correlations, setCorrelations] = useState<any>(null);
  const [sortConfig, setSortConfig] = useState<{ key: keyof FeatureRow; order: "asc" | "desc" }>({
    key: "anomalyScore",
    order: "desc",
  });
  const [filterAnomalies, setFilterAnomalies] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        const [datasetRes, statsRes, correlRes] = await Promise.all([
          fetchDataset(projectId),
          fetchDatasetStats(projectId),
          fetchCorrelationMatrix(projectId),
        ]);

        if (datasetRes.featureMatrix) {
          setDataset(datasetRes.featureMatrix);
        }

        if (statsRes.stats) {
          setStats(statsRes.stats);
          setRiskDistribution(statsRes.riskDistribution);
        }

        if (correlRes) {
          setCorrelations(correlRes);
        }
      } catch (err) {
        console.error("Error loading dataset:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [projectId]);

  const sortedDataset = [...dataset].sort((a, b) => {
    const key = sortConfig.key;
    const aVal = a[key] ?? 0;
    const bVal = b[key] ?? 0;
    
    let cmp: number;
    if (typeof aVal === "number" && typeof bVal === "number") {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal).localeCompare(String(bVal));
    }
    
    return sortConfig.order === "asc" ? cmp : -cmp;
  });

  const filteredDataset = filterAnomalies ? sortedDataset.filter((r) => r.isAnomaly) : sortedDataset;

  const handleSort = (key: keyof FeatureRow) => {
    setSortConfig({
      key,
      order: sortConfig.key === key && sortConfig.order === "asc" ? "desc" : "asc",
    });
  };

  if (loading) {
    return (
      <div className="page">
        <div className="loading-spinner" />
        <p style={{ textAlign: "center", marginTop: 20 }}>Loading dataset...</p>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>Project</Link> / <span>Dataset Browser</span>
      </div>

      <div className="page-header">
        <h1>📊 Dataset Corpus</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => exportDataset(projectId, "csv")} className="btn">
            📥 Export CSV
          </button>
          <button onClick={() => exportDataset(projectId, "json")} className="btn">
            📥 Export JSON
          </button>
          <Link to={`/project/${projectId}/ml`} className="btn">
            Back to ML Analysis
          </Link>
        </div>
      </div>

      {/* Statistics Cards */}
      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Packages</div>
            <div className="stat-value">{stats.total_packages}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Anomalies Detected</div>
            <div className="stat-value" style={{ color: "var(--red)" }}>
              {stats.total_anomalies}
            </div>
            <div className="stat-sublabel">{stats.anomaly_percentage.toFixed(2)}%</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Anomaly Score</div>
            <div className="stat-value">{stats.anomaly_score_mean.toFixed(3)}</div>
            <div className="stat-sublabel">σ = {stats.anomaly_score_std.toFixed(3)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Score Range</div>
            <div className="stat-value">[{stats.anomaly_score_min.toFixed(2)}, {stats.anomaly_score_max.toFixed(2)}]</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Package Age</div>
            <div className="stat-value">{stats.avg_package_age_days.toFixed(0)} days</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Avg Maintainers</div>
            <div className="stat-value">{stats.avg_maintainer_count.toFixed(1)}</div>
          </div>
        </div>
      )}

      {/* Risk Distribution */}
      {riskDistribution.length > 0 && (
        <div className="dataset-section">
          <h3>📈 Risk Score Distribution</h3>
          <div className="risk-histogram">
            {riskDistribution.map((bin) => {
              const maxCount = Math.max(...riskDistribution.map((b) => b.count));
              const percentage = (bin.count / maxCount) * 100;
              return (
                <div key={bin.bin} className="histogram-bar">
                  <div className="bar-label">{bin.bin}</div>
                  <div className="bar-container">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${percentage}%`,
                        background:
                          bin.bin.includes("Critical") || bin.bin.includes("High")
                            ? "var(--red)"
                            : bin.bin.includes("Medium-High")
                              ? "var(--orange)"
                              : bin.bin.includes("Medium-Low")
                                ? "var(--yellow)"
                                : "var(--green)",
                      }}
                    />
                  </div>
                  <div className="bar-count">{bin.count}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top Anomalies */}
      {stats?.top_anomalies && stats.top_anomalies.length > 0 && (
        <div className="dataset-section">
          <h3>⚠️ Top 10 Detected Anomalies</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Package</th>
                <th>Version</th>
                <th>Age (days)</th>
                <th>Maintainers</th>
                <th>Anomaly Score</th>
              </tr>
            </thead>
            <tbody>
              {stats.top_anomalies.map((row, idx) => (
                <tr key={idx}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.version}</td>
                  <td>{row.ageDays}</td>
                  <td>{row.maintainerCount}</td>
                  <td>
                    <span
                      style={{
                        color: "var(--red)",
                        fontWeight: 600,
                      }}
                    >
                      {(row.anomalyScore * 100).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full Dataset Table */}
      <div className="dataset-section">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3>📋 Full Dataset</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={filterAnomalies}
              onChange={(e) => setFilterAnomalies(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Show only anomalies ({filteredDataset.length})
          </label>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort("name")} style={{ cursor: "pointer" }}>
                  Package {sortConfig.key === "name" && (sortConfig.order === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("version")} style={{ cursor: "pointer" }}>
                  Version
                </th>
                <th onClick={() => handleSort("ageDays")} style={{ cursor: "pointer" }}>
                  Age (days) {sortConfig.key === "ageDays" && (sortConfig.order === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("maintainerCount")} style={{ cursor: "pointer" }}>
                  Maintainers {sortConfig.key === "maintainerCount" && (sortConfig.order === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("depth")} style={{ cursor: "pointer" }}>
                  Depth {sortConfig.key === "depth" && (sortConfig.order === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("riskScore")} style={{ cursor: "pointer" }}>
                  Risk Score {sortConfig.key === "riskScore" && (sortConfig.order === "asc" ? "↑" : "↓")}
                </th>
                <th onClick={() => handleSort("anomalyScore")} style={{ cursor: "pointer" }}>
                  Anomaly Score {sortConfig.key === "anomalyScore" && (sortConfig.order === "asc" ? "↑" : "↓")}
                </th>
                <th>Flagged</th>
              </tr>
            </thead>
            <tbody>
              {filteredDataset.slice(0, 100).map((row, idx) => (
                <tr key={idx} style={{ backgroundColor: row.isAnomaly ? "rgba(239, 68, 68, 0.08)" : "" }}>
                  <td>
                    <code>{row.name}</code>
                  </td>
                  <td>{row.version}</td>
                  <td>{row.ageDays}</td>
                  <td>{row.maintainerCount}</td>
                  <td>{row.depth}</td>
                  <td>
                    <span style={{ color: row.riskScore > 50 ? "var(--red)" : row.riskScore > 25 ? "var(--yellow)" : "var(--green)" }}>
                      {row.riskScore.toFixed(1)}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: row.anomalyScore > 0.5 ? "var(--red)" : "var(--green)" }}>
                      {(row.anomalyScore * 100).toFixed(1)}%
                    </span>
                  </td>
                  <td>{row.isAnomaly ? "⚠️ YES" : "✓"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredDataset.length > 100 && <p style={{ marginTop: 12, color: "var(--muted)" }}>Showing first 100 of {filteredDataset.length} records</p>}
        </div>
      </div>

      {/* Correlation Matrix */}
      {correlations && (
        <div className="dataset-section">
          <h3>📊 Feature Correlation Matrix</h3>
          <div className="correlation-table">
            <table style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th></th>
                  {Object.keys(correlations).map((key) => (
                    <th key={key} style={{ padding: "4px 8px", textAlign: "center" }}>
                      {key.substring(0, 4)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(correlations).map(([f1, row]: [string, any]) => (
                  <tr key={f1}>
                    <td style={{ textAlign: "left", fontWeight: 600, padding: "4px 8px" }}>{f1.substring(0, 4)}</td>
                    {Object.values(row as Record<string, number>).map((val: number, idx: number) => {
                      const absVal = Math.abs(val);
                      const color =
                        absVal > 0.7 ? "rgba(239, 68, 68, 0.3)" : absVal > 0.4 ? "rgba(234, 179, 8, 0.2)" : "rgba(100, 100, 100, 0.1)";
                      return (
                        <td
                          key={idx}
                          style={{
                            padding: "4px 8px",
                            textAlign: "center",
                            background: color,
                            fontSize: 11,
                          }}
                        >
                          {(val as number).toFixed(2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ marginTop: 8, fontSize: 12, color: "var(--muted)" }}>
            Correlation values range from -1 (negative correlation) to 1 (positive correlation). Red indicates strong correlation.
          </p>
        </div>
      )}
    </div>
  );
}
