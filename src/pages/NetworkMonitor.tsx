import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchNetworkActivity, fetchProject, type NetworkActivity } from "../api";
import type { Project } from "../types";

export default function NetworkMonitor() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [activity, setActivity] = useState<NetworkActivity | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetchProject(projectId).then(setProject).catch(() => setProject(null));
    fetchNetworkActivity(projectId).then((result) => { setActivity(result); setError(null); }).catch((reason: Error) => setError(reason.message));
  }, [projectId]);
  if (error) return <div className="page"><div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>Project</Link> / <span>Network activity</span></div><div className="empty-state"><h2>Network activity unavailable</h2><p className="muted">{error}</p><Link to={`/project/${projectId}`} className="btn btn-primary">Run a scan</Link></div></div>;
  if (!activity) return <div className="page"><div className="loading-spinner" />Loading project activity…</div>;
  const reviewCount = activity.events.filter((event) => event.policy === "review" || event.outcome === "failed").length;
  return <div className="page network-monitor-page">
    <div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{project?.name || "Project"}</Link> / <span>Network activity</span></div>
    <div className="page-header"><div><span className="eyebrow">Scanner evidence</span><h1>Network activity</h1><p className="muted">Recorded external requests made while scanning this project.</p></div><Link to={`/project/${projectId}`} className="btn">Back to project</Link></div>
    <section className="network-summary"><article className="card network-stat"><span className="network-stat-label">Project</span><strong>{project?.name || `#${projectId}`}</strong><small>{activity.commitHash ? `Commit ${activity.commitHash.slice(0, 8)}` : "Commit unavailable"}</small></article><article className="card network-stat"><span className="network-stat-label">Requests recorded</span><strong>{activity.events.length}</strong><small>scanner HTTP and checkout events</small></article><article className="card network-stat"><span className="network-stat-label">Needs review</span><strong className={reviewCount ? "review-text" : "safe-text"}>{reviewCount}</strong><small>failed or policy-review events</small></article><article className="card network-stat"><span className="network-stat-label">Policy</span><strong className="safe-text">Allowlist</strong><small>source control, registries, advisories</small></article></section>
    <section className="network-layout"><article className="card network-card"><div className="section-heading"><div><h2>Recorded connections</h2><p>Only requests emitted by the scanner are listed.</p></div><span className="monitor-state monitoring">Completed scan</span></div><div className="telemetry-table" role="table"><div className="telemetry-row telemetry-head" role="row"><span>Time</span><span>Destination</span><span>Transport</span><span>Policy</span></div>{activity.events.map((event) => <div className="telemetry-row" role="row" key={`${event.observedAt}-${event.destination}-${event.purpose}`}><span className="telemetry-time">{new Date(event.observedAt).toLocaleTimeString()}</span><span><strong>{event.destination}</strong><small>{event.purpose}</small></span><span>{event.protocol} : {event.port}</span><span className={`policy-badge ${event.policy === "expected" && event.outcome !== "failed" ? "expected" : "review"}`}>{event.outcome === "failed" ? "Failed" : event.policy === "expected" ? "Allowed" : "Review"}</span></div>)}{activity.events.length === 0 && <div className="signals-empty">No outbound scanner requests were recorded for this scan.</div>}</div></article><aside className="network-side"><article className="card network-card"><div className="section-heading"><div><h2>Expected policy</h2><p>Services used by the selected ecosystem.</p></div></div><ul className="allowlist">{activity.allowlist.map((entry) => <li key={entry.destination}><span className="allow-icon">OK</span><span><strong>{entry.destination}</strong><small>{entry.protocol} : {entry.port} - {entry.purpose}</small></span></li>)}</ul></article></aside></section>
  </div>;
}
