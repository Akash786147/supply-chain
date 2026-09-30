import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchMLStats, subscribeToUpdates } from "../api";
import type { MLStats } from "../types";

const featureLabels: Record<string, string> = {
  maintainerCount: "Maintainer count",
  ageDays: "Package age",
  daysSinceUpdate: "Time since update",
  depth: "Dependency depth",
  blastRadius: "Dependency reach",
  pagerank: "Graph influence",
  centrality: "Graph connectivity",
};

export default function MLAnalysis() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [stats, setStats] = useState<MLStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => fetchMLStats(projectId).then((value) => { setStats(value); setError(null); })
      .catch(() => setError("No ML analysis is available yet. Run a scan first."));
    refresh();
    return subscribeToUpdates((update) => {
      if (update.type === "connection" && update.status === "connected") refresh();
      else if (update.projectId === projectId) refresh();
    });
  }, [projectId]);

  if (error) return <div className="page"><div className="empty-state"><h2>ML analysis unavailable</h2><p className="muted">{error}</p><Link to={`/project/${projectId}`} className="btn btn-primary">Go to project</Link></div></div>;
  if (!stats) return <div className="page"><div className="loading-spinner" />Loading outlier analysis…</div>;

  const evaluation = stats.evaluation;
  const anomalies = stats.featureMatrix.filter((feature) => feature.isAnomaly).sort((a, b) => b.anomalyScore - a.anomalyScore);
  const enoughSamples = evaluation?.status === "scored" && stats.totalPackages >= (evaluation.minimumSamples || 20);
  const featureCoverage = stats.featureCoverage || {};

  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>Project</Link> / <span>ML Outlier Analysis</span></div>
      <div className="page-header">
        <div><h1>ML Outlier Analysis</h1><p className="muted">Isolation Forest finds packages whose measured metadata or dependency position differs from the rest of this repository.</p></div>
        <Link to={`/project/${projectId}/risk`} className="btn">Security findings</Link>
      </div>

      <div className="error-banner" style={{ color: "var(--text-secondary)", borderColor: "var(--border)", background: "var(--bg-card)" }}>
        An outlier is a review lead, not evidence of a vulnerability. This unsupervised model has no labelled training set, so this screen does not claim accuracy, precision, or exploit probability.
      </div>

      <div className="risk-overview" style={{ marginTop: 18 }}>
        <div className="card stat-card"><div className="stat-value">{stats.totalPackages}</div><div className="stat-label">Packages evaluated</div></div>
        <div className="card stat-card"><div className="stat-value">{enoughSamples ? stats.totalAnomalies : "—"}</div><div className="stat-label">Unusual packages</div></div>
        <div className="card stat-card"><div className="stat-value">{enoughSamples && evaluation?.anomalyRate !== undefined ? `${(evaluation.anomalyRate * 100).toFixed(1)}%` : "—"}</div><div className="stat-label">Share marked as outliers</div></div>
        <div className="card stat-card"><div className="stat-value">{enoughSamples ? "Scored" : "Not enough data"}</div><div className="stat-label">Model status</div></div>
      </div>

      {!enoughSamples ? (
        <div className="card" style={{ marginTop: 20 }}>
          <h2>Outlier statistics hidden</h2>
          <p className="muted">The model needs at least {evaluation?.minimumSamples || 20} third-party dependency records for a minimally useful comparison. This scan has {stats.totalPackages}. It will not label this small sample safe or suspicious.</p>
        </div>
      ) : (
        <>
          <div className="card" style={{ marginTop: 20 }}>
            <h2>Inputs used</h2>
            <p className="muted">Measured package metadata and dependency graph position. Missing registry values are median-filled for scoring and are not treated as evidence of risk.</p>
            <div className="sbom-feature-list">
              {stats.featureNames.map((name) => <span className="badge" key={name}>{featureLabels[name] || name} · {Math.round((featureCoverage[name] || 0) * 100)}% available</span>)}
            </div>
          </div>

          <div className="card" style={{ marginTop: 20 }}>
            <div className="pipeline-header"><h2 style={{ margin: 0 }}>Packages that differ from peers</h2><span className="muted">Ranked by relative outlier score</span></div>
            {anomalies.length === 0 ? <p className="muted">No packages were marked as outliers in this scan.</p> : <div className="signals-table" style={{ marginTop: 14 }}>
              <div className="signals-table-head"><span>Package</span><span>Outlier score</span><span>Observed differences</span><span>Interpretation</span></div>
              {anomalies.map((feature) => <div className="signals-table-row" key={`${feature.name}@${feature.version}`}>
                <span className="signal-package">{feature.name}@{feature.version}</span>
                <span>{(feature.anomalyScore * 100).toFixed(0)} / 100</span>
                <span>{feature.anomalyReasons?.length ? feature.anomalyReasons.join(", ") : "Combined feature pattern"}</span>
                <span className="muted">Review alongside the package advisory and source evidence before taking action.</span>
              </div>)}
            </div>}
          </div>
        </>
      )}
    </div>
  );
}
