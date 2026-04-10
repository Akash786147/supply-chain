import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProjects, createProject, deleteProject, fetchGlobalStats } from "../api";
import type { Project, GlobalStats } from "../types";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);

  const loadData = () => {
    fetchProjects().then(setProjects);
    fetchGlobalStats().then(setGlobalStats).catch(() => {});
  };

  useEffect(() => {
    loadData();
    // Poll for status updates every 5 seconds
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleAdd = async () => {
    if (!repoUrl.trim()) return;
    const p = await createProject(repoUrl.trim());
    setProjects((prev) => [...prev, p]);
    setRepoUrl("");
    setShowForm(false);
  };

  const handleDelete = async (id: number) => {
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
  };

  const statusColor = (s: string) => {
    if (s === "success") return "var(--green)";
    if (s === "warning" || s === "running" || s === "pending") return "var(--yellow)";
    if (s === "failed") return "var(--red)";
    return "var(--muted)";
  };

  const riskColor = (r: string) => {
    if (r === "critical" || r === "high") return "var(--red)";
    if (r === "medium") return "var(--yellow)";
    if (r === "low") return "var(--green)";
    return "var(--muted)";
  };

  const ecoIcon = (eco: string) => {
    if (eco === "pypi" || eco === "python") return "🐍";
    return "📦";
  };

  return (
    <div className="page">
      {/* Global Stats Bar */}
      {globalStats && globalStats.totalScans > 0 && (
        <div className="global-stats-bar">
          <div className="global-stat">
            <span className="global-stat-value">{globalStats.totalScans}</span>
            <span className="global-stat-label">Total Scans</span>
          </div>
          <div className="global-stat">
            <span className="global-stat-value">{globalStats.totalPackagesAnalyzed.toLocaleString()}</span>
            <span className="global-stat-label">Packages Analyzed</span>
          </div>
          <div className="global-stat">
            <span className="global-stat-value" style={{ color: "var(--red)" }}>{globalStats.totalAnomalies}</span>
            <span className="global-stat-label">Anomalies Found</span>
          </div>
          <div className="global-stat">
            <span className="global-stat-value" style={{ color: globalStats.avgRiskScore > 40 ? "var(--red)" : globalStats.avgRiskScore > 20 ? "var(--yellow)" : "var(--green)" }}>
              {globalStats.avgRiskScore}
            </span>
            <span className="global-stat-label">Avg Risk Score</span>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>Projects</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          + Import Repository
        </button>
      </div>

      {showForm && (
        <div className="card import-card" style={{ marginBottom: 20 }}>
          <h3>Connect Public Repository</h3>
          <p className="muted" style={{ margin: "4px 0 12px" }}>
            Paste any public GitHub repository URL. DepGuard will clone, analyze dependencies, and run ML anomaly detection.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              className="input"
              placeholder="https://github.com/expressjs/express"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button className="btn btn-primary" onClick={handleAdd}>
              Analyze
            </button>
          </div>
        </div>
      )}

      <div className="project-grid">
        {projects.map((p) => (
          <div className={`card project-card ${p.status === "running" || p.status === "pending" ? "card-pulse" : ""}`} key={p.id}>
            <div className="project-card-header">
              <Link to={`/project/${p.id}`} className="project-name">
                <span className="eco-icon">{ecoIcon(p.ecosystem)}</span>
                {p.name}
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(p.id)}>×</button>
            </div>
            <div className="project-meta">
              <span className="branch-badge">{p.branch}</span>
              <span className="eco-badge">{p.ecosystem}</span>
              {(p.status === "running" || p.status === "pending") && (
                <span className="badge badge-yellow pulse-badge">⟳ Scanning...</span>
              )}
            </div>
            <div className="project-status-row">
              <span className={`status-dot ${p.status === "running" ? "status-dot-pulse" : ""}`} style={{ background: statusColor(p.status) }} />
              <span>{p.status}</span>
              <span style={{ marginLeft: "auto", color: riskColor(p.riskLevel), fontWeight: 600 }}>
                {p.riskLevel !== "unknown" ? `${p.riskLevel} risk` : "—"}
              </span>
            </div>
            <div className="project-footer">
              <span className="muted">
                {p.lastScanAt ? `Scanned ${new Date(p.lastScanAt).toLocaleDateString()}` : "Not scanned yet"}
              </span>
              <div className="project-links">
                <Link to={`/project/${p.id}`}>Pipelines</Link>
                <Link to={`/project/${p.id}/tree`}>Tree</Link>
                <Link to={`/project/${p.id}/risk`}>Risk</Link>
                <Link to={`/project/${p.id}/ml`}>ML</Link>
                <Link to={`/project/${p.id}/graph`}>Graph</Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="empty-state">
          <span className="empty-icon">🛡️</span>
          <h2>No Projects Yet</h2>
          <p className="muted">Import a public GitHub repository to start analyzing its supply chain.</p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Import Repository</button>
        </div>
      )}
    </div>
  );
}
