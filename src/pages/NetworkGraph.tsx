import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchDependencyTree, subscribeToUpdates } from "../api";
import type { DepNode } from "../types";

type Vulnerability = { id: string; severity?: string; summary?: string };
type NodeWithAdvisories = DepNode & { vulnerabilities?: Vulnerability[] };

interface BranchSummary {
  packages: number;
  affectedPackages: number;
  advisories: number;
  highestSeverity: string | null;
}

const severityRank: Record<string, number> = { critical: 4, high: 3, medium: 2, moderate: 2, low: 1 };

function summarize(node: NodeWithAdvisories): BranchSummary {
  let packages = 0;
  let affectedPackages = 0;
  const advisories = new Set<string>();
  let highestSeverity: string | null = null;

  const visit = (current: NodeWithAdvisories) => {
    packages += 1;
    const currentVulnerabilities = current.vulnerabilities || [];
    if (currentVulnerabilities.length) affectedPackages += 1;
    for (const vulnerability of currentVulnerabilities) {
      advisories.add(vulnerability.id);
      const severity = (vulnerability.severity || "unknown").toLowerCase();
      if ((severityRank[severity] || 0) > (severityRank[highestSeverity || ""] || 0)) highestSeverity = severity;
    }
    for (const child of current.children || []) visit(child as NodeWithAdvisories);
  };

  visit(node);
  return { packages, affectedPackages, advisories: advisories.size, highestSeverity };
}

function severityColor(severity: string | null): string {
  if (severity === "critical" || severity === "high") return "var(--red)";
  if (severity === "medium" || severity === "moderate") return "var(--yellow)";
  if (severity === "low") return "var(--blue, #60a5fa)";
  return "var(--muted)";
}

export default function NetworkGraph() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [tree, setTree] = useState<DepNode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchDependencyTree(projectId)
      .then((value) => { setTree(value); setError(null); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load dependencies."));
  }, [projectId]);

  useEffect(() => {
    refresh();
    return subscribeToUpdates((update) => {
      if ((update.type === "connection" && update.status === "connected") || update.projectId === projectId) refresh();
    });
  }, [projectId, refresh]);

  if (!tree && !error) return <div className="page"><div className="loading-spinner" />Loading dependency DAG...</div>;
  if (!tree) return <div className="page"><div className="empty-state"><h2>Dependency data unavailable</h2><p className="muted">{error}</p><Link className="btn btn-primary" to={`/project/${projectId}`}>Back to project</Link></div></div>;

  const roots = tree.children || [];
  const codeFindingCount = tree.scanMeta?.sourceFindingCount ?? 0;

  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{tree.name}</Link> / <span>Dependency DAG</span></div>
      <div className="page-header">
        <div>
          <h1>Dependency DAG</h1>
          <p className="muted">Start with direct dependencies. Expand a package to inspect its own dependency branch.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to={`/project/${projectId}/risk`} className="btn">Security findings</Link>
          <Link to={`/project/${projectId}/sbom`} className="btn">View SBOM</Link>
        </div>
      </div>

      <div className="dependency-overview">
        <div className="card stat-card"><div className="stat-value">{roots.length}</div><div className="stat-label">Direct dependencies</div></div>
        <div className="card stat-card"><div className="stat-value">{roots.reduce((sum, node) => sum + summarize(node as NodeWithAdvisories).packages, 0)}</div><div className="stat-label">Packages in dependency tree</div></div>
        <div className="card stat-card"><div className="stat-value">{codeFindingCount}</div><div className="stat-label">Source code findings</div></div>
      </div>

      {codeFindingCount > 0 && <div className="card dag-source-note"><span><strong>{codeFindingCount} source-code finding{codeFindingCount === 1 ? "" : "s"}</strong> are available in the project findings view.</span><Link to={`/project/${projectId}/risk`}>Review findings →</Link></div>}

      <section className="dag-panel">
        <div className="dag-panel-heading">
          <div><h2>Direct dependencies</h2><p className="muted">Each branch stays collapsed until you open it. Advisory summaries include the full branch.</p></div>
          <span className="muted">{roots.length} top-level packages</span>
        </div>
        {roots.length === 0 ? <div className="dag-empty">No dependency tree is available for this scan.</div> : (
          <div className="dag-tree" role="tree" aria-label="Project dependency tree">
            {roots.map((node, index) => <DependencyBranch key={`${node.id}-${node.version}-${index}`} node={node as NodeWithAdvisories} path={`${index}`} depth={0} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function DependencyBranch({ node, path, depth }: { node: NodeWithAdvisories; path: string; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const children = node.children || [];
  const hasChildren = children.length > 0;
  const summary = summarize(node);
  const ownVulnerabilities = node.vulnerabilities || [];
  const color = severityColor(summary.highestSeverity);

  return (
    <div className="dag-branch" role="treeitem" aria-expanded={hasChildren ? expanded : undefined}>
      <div className={`dag-row ${hasChildren ? "dag-row-expandable" : ""}`} style={{ "--dag-depth": depth } as React.CSSProperties}>
        <button
          type="button"
          className="dag-expand"
          aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name} dependencies`}
          aria-expanded={expanded}
          disabled={!hasChildren}
          onClick={() => setExpanded((value) => !value)}
        >{hasChildren ? (expanded ? "▾" : "▸") : "·"}</button>
        <span className="dag-package"><strong>{node.name}</strong><span>@{node.version || "unknown"}</span></span>
        <span className="dag-branch-size">{hasChildren ? `${summary.packages - 1} nested package${summary.packages === 2 ? "" : "s"}` : "No dependencies"}</span>
        {ownVulnerabilities.length > 0 ? (
          <span className="dag-advisory-badge" style={{ color, borderColor: color }} title={`${ownVulnerabilities.length} advisory finding(s) on this package`}>
            {ownVulnerabilities.length} finding{ownVulnerabilities.length === 1 ? "" : "s"} here
          </span>
        ) : summary.advisories > 0 ? (
          <span className="dag-advisory-summary" style={{ color }} title={`${summary.advisories} unique advisories affect ${summary.affectedPackages} package(s) in this branch`}>
            {summary.advisories} {summary.advisories === 1 ? "advisory" : "advisories"} · {summary.affectedPackages} affected
          </span>
        ) : <span className="dag-clear-badge">No known advisories</span>}
        {hasChildren && <span className="dag-expand-hint">{expanded ? "Hide children" : "Expand branch"}</span>}
      </div>
      {expanded && hasChildren && <div className="dag-children" role="group">{children.map((child, index) => <DependencyBranch key={`${path}.${child.id}-${child.version}-${index}`} node={child as NodeWithAdvisories} path={`${path}.${index}`} depth={depth + 1} />)}</div>}
    </div>
  );
}
