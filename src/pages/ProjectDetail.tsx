import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProject, fetchPipelines, triggerScan } from "../api";
import type { Project, Pipeline } from "../types";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    fetchProject(projectId).then(setProject);
    fetchPipelines(projectId).then(setPipelines);
  }, [projectId]);

  const handleScan = async () => {
    setScanning(true);
    const p = await triggerScan(projectId);
    setPipelines((prev) => [p, ...prev]);
    // Re-fetch after pipeline completes
    setTimeout(async () => {
      const updated = await fetchPipelines(projectId);
      setPipelines(updated.reverse());
      const proj = await fetchProject(projectId);
      setProject(proj);
      setScanning(false);
    }, 4000);
  };

  const statusIcon = (s: string) => {
    if (s === "success") return "✓";
    if (s === "failed") return "✗";
    if (s === "running") return "◌";
    if (s === "pending") return "○";
    return "·";
  };

  const statusColor = (s: string) => {
    if (s === "success") return "var(--green)";
    if (s === "failed") return "var(--red)";
    if (s === "running") return "var(--blue)";
    return "var(--muted)";
  };

  const decisionBadge = (d: string | null) => {
    if (d === "pass") return <span className="badge badge-green">PASS</span>;
    if (d === "warn") return <span className="badge badge-yellow">WARN</span>;
    if (d === "block") return <span className="badge badge-red">BLOCK</span>;
    return <span className="badge">PENDING</span>;
  };

  if (!project) return <div className="page">Loading...</div>;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <span>{project.name}</span>
      </div>

      <div className="page-header">
        <div>
          <h1>{project.name}</h1>
          <div className="project-meta" style={{ marginTop: 4 }}>
            <span className="branch-badge">{project.branch}</span>
            <span className="eco-badge">{project.ecosystem}</span>
            <span className="muted">{project.repoUrl}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/project/${project.id}/tree`} className="btn">
            Dependency Tree
          </Link>
          <Link to={`/project/${project.id}/risk`} className="btn">
            Risk Analysis
          </Link>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? "Scanning..." : "▶ Run Scan"}
          </button>
        </div>
      </div>

      <h2>Analysis Pipelines</h2>
      <div className="pipeline-list">
        {pipelines.length === 0 && <p className="muted">No pipelines yet. Run a scan to start.</p>}
        {pipelines.map((pl) => (
          <div className="card pipeline-card" key={pl.id}>
            <div className="pipeline-header">
              <div>
                <span className="pipeline-id">#{pl.id}</span>
                <span className="commit-badge">{pl.commit}</span>
                <span className="muted">{pl.trigger} → {pl.branch}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {decisionBadge(pl.decision)}
                <span style={{ color: statusColor(pl.status), fontWeight: 600 }}>{pl.status}</span>
              </div>
            </div>

            <div className="pipeline-steps">
              {pl.steps.map((step, i) => (
                <div className="pipeline-step" key={i}>
                  <span className="step-icon" style={{ color: statusColor(step.status) }}>
                    {statusIcon(step.status)}
                  </span>
                  <span className="step-name">{step.name}</span>
                  <span className="step-duration">{step.duration}</span>
                </div>
              ))}
            </div>

            {pl.riskSummary && (
              <div className="pipeline-risk-summary">
                <span className="risk-count risk-critical">{pl.riskSummary.critical} critical</span>
                <span className="risk-count risk-high">{pl.riskSummary.high} high</span>
                <span className="risk-count risk-medium">{pl.riskSummary.medium} medium</span>
                <span className="risk-count risk-low">{pl.riskSummary.low} low</span>
              </div>
            )}

            <div className="pipeline-footer">
              <span className="muted">
                Started {new Date(pl.startedAt).toLocaleString()}
                {pl.finishedAt && ` · Finished ${new Date(pl.finishedAt).toLocaleString()}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
