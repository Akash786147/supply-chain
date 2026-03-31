import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { fetchDependencyTree } from "../api";
import type { DepNode } from "../types";

export default function DependencyTree() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [tree, setTree] = useState<DepNode | null>(null);
  const [expandAll, setExpandAll] = useState(false);

  useEffect(() => {
    fetchDependencyTree(projectId).then(setTree);
  }, [projectId]);

  // Force re-render with new expand state
  const [key, setKey] = useState(0);
  const toggleExpandAll = () => {
    setExpandAll(!expandAll);
    setKey((k) => k + 1);
  };

  if (!tree) return <div className="page">Loading dependency tree...</div>;

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{tree.name}</Link> / <span>Dependency Tree</span>
      </div>

      <div className="page-header">
        <h1>Dependency Tree</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={toggleExpandAll}>
            {expandAll ? "Collapse All" : "Expand All"}
          </button>
          <Link to={`/project/${projectId}/risk`} className="btn">
            Risk Analysis
          </Link>
        </div>
      </div>

      <div className="tree-legend">
        <span><span className="legend-dot" style={{ background: "var(--green)" }} /> Low (0–25)</span>
        <span><span className="legend-dot" style={{ background: "var(--yellow)" }} /> Medium (26–50)</span>
        <span><span className="legend-dot" style={{ background: "var(--red)" }} /> High (51–75)</span>
        <span><span className="legend-dot" style={{ background: "var(--red)" }} /> Critical (76+)</span>
      </div>

      <div className="tree-container" key={key}>
        <ExpandContext.Provider value={expandAll}>
          <TreeNodeControlled node={tree} depth={0} isLast={true} prefix="" />
        </ExpandContext.Provider>
      </div>
    </div>
  );
}

// Context for expand-all control
import { createContext, useContext } from "react";
const ExpandContext = createContext(false);

function TreeNodeControlled({ node, depth, isLast, prefix }: { node: DepNode; depth: number; isLast: boolean; prefix: string }) {
  const expandAll = useContext(ExpandContext);
  const [collapsed, setCollapsed] = useState(expandAll ? false : depth > 2);
  const hasChildren = node.children && node.children.length > 0;

  useEffect(() => {
    setCollapsed(expandAll ? false : depth > 2);
  }, [expandAll, depth]);

  const riskColor = (level: string) => {
    if (level === "critical" || level === "high") return "var(--red)";
    if (level === "medium") return "var(--yellow)";
    return "var(--green)";
  };

  const riskBg = (level: string) => {
    if (level === "critical" || level === "high") return "rgba(239,68,68,0.08)";
    if (level === "medium") return "rgba(234,179,8,0.08)";
    return "transparent";
  };

  const connector = depth === 0 ? "" : isLast ? "└── " : "├── ";
  const childPrefix = depth === 0 ? "" : prefix + (isLast ? "    " : "│   ");

  return (
    <div className="tree-node-wrapper">
      <div
        className={`tree-node ${hasChildren ? "tree-node-clickable" : ""}`}
        style={{ background: riskBg(node.riskLevel) }}
        onClick={() => hasChildren && setCollapsed(!collapsed)}
      >
        <code className="tree-prefix">{prefix}{connector}</code>
        {hasChildren && (
          <span className="tree-toggle">{collapsed ? "▸" : "▾"}</span>
        )}
        {!hasChildren && <span className="tree-toggle-placeholder" />}
        <span className="tree-package-name">{node.name}</span>
        <span className="tree-version">@{node.version}</span>
        <span className="tree-score" style={{ color: riskColor(node.riskLevel) }}>
          score: {node.riskScore}
        </span>
        <span className="tree-risk-badge" style={{ color: riskColor(node.riskLevel), borderColor: riskColor(node.riskLevel) }}>
          {node.riskLevel}
        </span>
        {node.signals && node.signals.length > 0 && (
          <span className="tree-signals">
            {node.signals.map((s) => (
              <span key={s} className="signal-tag">{s}</span>
            ))}
          </span>
        )}
      </div>
      {hasChildren && !collapsed && (
        <div className="tree-children">
          {node.children.map((child, i) => (
            <TreeNodeControlled
              key={child.id}
              node={child}
              depth={depth + 1}
              isLast={i === node.children.length - 1}
              prefix={childPrefix}
            />
          ))}
        </div>
      )}
    </div>
  );
}
