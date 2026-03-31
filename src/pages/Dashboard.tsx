import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchProjects, createProject, deleteProject } from "../api";
import type { Project } from "../types";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");

  useEffect(() => {
    fetchProjects().then(setProjects);
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
    if (s === "warning" || s === "building...") return "var(--yellow)";
    if (s === "failed") return "var(--red)";
    return "var(--muted)";
  };

  const riskColor = (r: string) => {
    if (r === "critical" || r === "high") return "var(--red)";
    if (r === "medium") return "var(--yellow)";
    if (r === "low") return "var(--green)";
    return "var(--muted)";
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Projects</h1>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          + Import Project
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 20 }}>
          <h3>Connect Repository</h3>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <input
              className="input"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
            <button className="btn btn-primary" onClick={handleAdd}>
              Connect
            </button>
          </div>
        </div>
      )}

      <div className="project-grid">
        {projects.map((p) => (
          <div className="card project-card" key={p.id}>
            <div className="project-card-header">
              <Link to={`/project/${p.id}`} className="project-name">
                {p.name}
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(p.id)}>
                ×
              </button>
            </div>
            <div className="project-meta">
              <span className="branch-badge">{p.branch}</span>
              <span className="eco-badge">{p.ecosystem}</span>
            </div>
            <div className="project-status-row">
              <span className="status-dot" style={{ background: statusColor(p.status) }} />
              <span>{p.status}</span>
              <span style={{ marginLeft: "auto", color: riskColor(p.riskLevel), fontWeight: 600 }}>
                {p.riskLevel} risk
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
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
