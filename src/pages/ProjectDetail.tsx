import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchProject, fetchPipelines, triggerScan, subscribeToUpdates } from "../api";
import type { Project, Pipeline } from "../types";

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [scanning, setScanning] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    const syncSnapshot = () => {
      fetchProject(projectId).then((value) => { setProject(value); setScanning(value.status === "running"); setPageError(null); })
        .catch(() => { setProject(null); setPageError("Project not found or the backend is unavailable."); });
      fetchPipelines(projectId).then((rows) => setPipelines(rows.sort((a, b) => b.id - a.id))).catch(() => setPipelines([]));
    };
    syncSnapshot();
    return subscribeToUpdates((update) => {
      if (update.type === "connection") {
        if (update.status === "connected") syncSnapshot();
        return;
      }
      if (update.projectId !== projectId) return;
      if (update.type === "pipeline" && update.pipeline) {
        const pipeline = update.pipeline;
        setPipelines((current) => [pipeline, ...current.filter((item) => item.id !== pipeline.id)].sort((a, b) => b.id - a.id));
        setScanning(pipeline.status === "running");
        if (pipeline.status !== "running") setScanning(false);
      }
      if (update.type === "project" && update.project) {
        setProject((current) => current ? { ...current, ...update.project } : current);
      }
    });
  }, [projectId]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const pipeline = await triggerScan(projectId);
      setPipelines((current) => [pipeline, ...current.filter((item) => item.id !== pipeline.id)]);
    } catch {
      setScanning(false);
    }
  };

  const statusIcon = (s: string) => {
    if (s === "success") return "✓";
    if (s === "failed") return "✗";
    if (s === "running") return "◌";
    if (s === "pending") return "○";
    if (s === "skipped") return "—";
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

  if (!project) return <div className="page">{pageError ? <div className="error-banner">{pageError}</div> : <><div className="loading-spinner" />Loading...</>}</div>;

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
          <Link to={`/project/${projectId}/sbom`} className="btn">View SBOM</Link>
          <Link to={`/project/${project.id}/tree`} className="btn">🌲 Tree</Link>
          <Link to={`/project/${project.id}/risk`} className="btn">⚠ Risk</Link>
          <Link to={`/project/${project.id}/ml`} className="btn">🧠 ML Outliers</Link>
          <Link to={`/project/${project.id}/graph`} className="btn">🕸️ Attention Map</Link>
          <Link to={`/project/${project.id}/history`} className="btn">📊 History</Link>
          <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
            {scanning ? "⟳ Scanning..." : "▶ Run Scan"}
          </button>
        </div>
      </div>

      {scanning && <div className="live-banner"><span className="live-dot" /> Scan progress is updating live</div>}
      {pageError && <div className="error-banner">{pageError}</div>}

      <h2>Analysis Pipelines</h2>
      <div className="pipeline-list">
        {pipelines.length === 0 && <p className="muted">No pipelines yet. Run a scan to start.</p>}
        {pipelines.map((pl) => (
          <div className={`card pipeline-card ${pl.status === "running" ? "card-pulse" : ""}`} key={pl.id}>
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
                <div className={`pipeline-step-wrap ${step.status === "failed" ? "step-failed" : ""}`} key={i}>
                  <div className={`pipeline-step ${step.status === "running" ? "step-running" : ""}`}>
                    <span className="step-icon" style={{ color: statusColor(step.status) }}>
                      {statusIcon(step.status)}
                    </span>
                    <span className="step-name">{step.name}</span>
                    <span className="step-duration">{step.duration}</span>
                  </div>
                  {step.error && <div className="pipeline-step-error"><strong>Failure detail:</strong> {step.error}</div>}
                </div>
              ))}
            </div>

            {pl.error && <div className="pipeline-error"><strong>Scan failed:</strong> {pl.error}</div>}

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
