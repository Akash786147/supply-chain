import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { downloadSbom, fetchDependencyTree, fetchSbom } from "../api";
import type { CycloneDxSbom, ScanMeta } from "../types";

export default function SbomViewer() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [sbom, setSbom] = useState<CycloneDxSbom | null>(null);
  const [scanMeta, setScanMeta] = useState<ScanMeta | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSbom(projectId).then(setSbom).catch((reason: Error) => setError(reason.message || "No SBOM is available. Run a scan first."));
    fetchDependencyTree(projectId).then((tree) => setScanMeta(tree.scanMeta || null)).catch(() => setScanMeta(null));
  }, [projectId]);

  const components = useMemo(() => (sbom?.components || []).filter((component) =>
    `${component.name} ${component.version || ""} ${component.purl || ""}`.toLowerCase().includes(search.toLowerCase())
  ).sort((a, b) => a.name.localeCompare(b.name)), [sbom, search]);

  if (error) return <div className="page"><div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>Project</Link> / <span>SBOM</span></div><div className="empty-state"><h2>SBOM unavailable</h2><p className="muted">{error}</p><Link to={`/project/${projectId}`} className="btn btn-primary">Go to project</Link></div></div>;
  if (!sbom) return <div className="page"><div className="loading-spinner" />Loading software inventory…</div>;

  const vulnerabilities = sbom.vulnerabilities || [];
  const projectName = sbom.metadata?.component?.name || "Scanned project";

  return (
    <div className="page">
      <div className="breadcrumb"><Link to="/">Projects</Link> / <Link to={`/project/${projectId}`}>{projectName}</Link> / <span>Software Bill of Materials</span></div>
      <div className="page-header">
        <div><h1>Software Bill of Materials</h1><p className="muted">CycloneDX {sbom.specVersion} · generated {sbom.metadata?.timestamp ? new Date(sbom.metadata.timestamp).toLocaleString() : "date unavailable"}</p></div>
        <div style={{ display: "flex", gap: 8 }}><Link to={`/project/${projectId}`} className="btn">Back to project</Link><button className="btn btn-primary" onClick={() => downloadSbom(projectId)}>Download CycloneDX JSON</button></div>
      </div>
      <div className="risk-overview">
        <div className="card stat-card"><div className="stat-value">{sbom.components.length}</div><div className="stat-label">Components</div></div>
        <div className="card stat-card"><div className="stat-value">{vulnerabilities.length}</div><div className="stat-label">Advisories</div></div>
        <div className="card stat-card"><div className="stat-value">{new Set(sbom.components.map((component) => component.name)).size}</div><div className="stat-label">Unique packages</div></div>
        <div className="card stat-card"><div className="stat-value">{sbom.metadata?.component?.version || "—"}</div><div className="stat-label">Project version</div></div>
      </div>
      {scanMeta && scanMeta.vulnerabilityScanStatus !== "complete" && <div className="error-banner">Advisory lookup status: {scanMeta.vulnerabilityScanStatus || "unknown"}. An empty vulnerability section is not a clean bill of health.</div>}

      <section style={{ marginTop: 28 }}>
        <div className="page-header"><div><h2>Components</h2><p className="muted">Package inventory from the scanned dependency tree.</p></div><input className="sbom-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter packages…" aria-label="Filter SBOM components" /></div>
        <div className="signals-table">
          <div className="signals-table-head"><span>Component</span><span>Version</span><span>License</span><span>Package URL</span></div>
          {components.map((component, index) => <div className="signals-table-row" key={`${component.purl}-${index}`}>
            <span className="signal-package">{component.name}</span><span>{component.version || "—"}</span><span>{component.licenses?.map((item) => item.license?.name).filter(Boolean).join(", ") || "Unknown"}</span><span className="muted">{component.purl || "—"}</span>
          </div>)}
          {components.length === 0 && <div className="signals-empty">No matching components.</div>}
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2>Vulnerability evidence</h2>
        {vulnerabilities.length === 0 ? <div className="card"><p className="muted">No advisories are listed in this SBOM. Check the scan status before treating this as a clean result.</p></div> : <div className="pipeline-list">
          {vulnerabilities.map((vulnerability, index) => <article className="card" key={`${vulnerability.id}-${index}`}>
            <div className="pipeline-header"><strong>{vulnerability.id}</strong><span>{vulnerability.ratings?.[0]?.severity || "Severity unavailable"}</span></div>
            <p className="muted">{vulnerability.description || "No advisory description supplied."}</p>
            <small className="muted">Affects {vulnerability.affects?.length || 0} listed component reference(s)</small>
            {vulnerability.references?.[0] && <a className="evidence-link" href={vulnerability.references[0].id} target="_blank" rel="noreferrer">Advisory reference ↗</a>}
          </article>)}
        </div>}
      </section>
    </div>
  );
}
