import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchProjects, createProject, deleteProject, fetchGlobalStats, subscribeToUpdates,
  fetchGitHubAuthStatus, logoutGitHub, startGitHubLogin, fetchGitHubRepos,
  fetchGitHubBranches, fetchGitHubRepository,
} from "../api";
import type { GitHubAuthStatus, GitHubBranch, GitHubRepository } from "../api";
import type { Project, GlobalStats } from "../types";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [repoUrl, setRepoUrl] = useState("");
  const [githubAuth, setGithubAuth] = useState<GitHubAuthStatus | null>(null);
  const [githubRepos, setGithubRepos] = useState<GitHubRepository[]>([]);
  const [nextRepoPage, setNextRepoPage] = useState<number | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepository | null>(null);
  const [repoSearch, setRepoSearch] = useState("");
  const [branches, setBranches] = useState<GitHubBranch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [publicRepository, setPublicRepository] = useState<(GitHubRepository & { branches: GitHubBranch[] }) | null>(null);
  const [importMode, setImportMode] = useState<"github" | "url">("github");
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [importing, setImporting] = useState(false);
  const [githubNotice, setGithubNotice] = useState<string | null>(null);
  const [globalStats, setGlobalStats] = useState<GlobalStats | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<"connected" | "reconnecting">("reconnecting");

  const loadData = () => {
    fetchProjects().then((rows) => { setProjects(rows); setApiError(null); })
      .catch(() => setApiError("Backend unavailable. Check the API URL and service status."));
    fetchGlobalStats().then(setGlobalStats).catch(() => setGlobalStats(null));
  };

  useEffect(() => {
    loadData();
    fetchGitHubAuthStatus().then(setGithubAuth).catch(() => setGithubAuth(null));
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get("github_auth");
    if (authResult === "connected") setGithubNotice("GitHub connected. Choose a repository and branch to analyze.");
    if (authResult === "denied") setGithubNotice("GitHub authorization was cancelled.");
    if (authResult === "failed" || authResult === "invalid_state") setGithubNotice("GitHub sign-in failed. Please try again.");
    if (authResult) window.history.replaceState({}, "", window.location.pathname);
    return subscribeToUpdates((update) => {
      if (update.type === "connection") {
        setLiveStatus(update.status || "reconnecting");
        if (update.status === "connected") loadData();
        return;
      }
      if (["project", "projects", "pipeline", "stats"].includes(update.type)) loadData();
    });
  }, []);

  useEffect(() => {
    if (!githubAuth?.authenticated) {
      setGithubRepos([]);
      setNextRepoPage(null);
      setSelectedRepo(null);
      setBranches([]);
      setSelectedBranch("");
      return;
    }
    fetchGitHubRepos(1).then(({ repos, nextPage }) => {
      setGithubRepos(repos);
      setNextRepoPage(nextPage);
    }).catch((error) => setApiError(error instanceof Error ? error.message : "Could not load GitHub repositories."));
  }, [githubAuth?.authenticated]);

  const chooseGitHubRepo = async (fullName: string) => {
    const repo = githubRepos.find((item) => item.fullName === fullName) || null;
    setSelectedRepo(repo);
    setBranches([]);
    setSelectedBranch("");
    if (!repo) return;
    setLoadingBranches(true);
    try {
      const available = await fetchGitHubBranches(repo.fullName);
      setBranches(available);
      setSelectedBranch(repo.defaultBranch || available[0]?.name || "");
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not load repository branches.");
    } finally {
      setLoadingBranches(false);
    }
  };

  const loadMoreGitHubRepos = async () => {
    if (!nextRepoPage) return;
    try {
      const { repos, nextPage } = await fetchGitHubRepos(nextRepoPage);
      setGithubRepos((current) => [...current, ...repos]);
      setNextRepoPage(nextPage);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not load more repositories.");
    }
  };

  const loadPublicRepository = async () => {
    if (!repoUrl.trim()) return;
    setLoadingBranches(true);
    setPublicRepository(null);
    setBranches([]);
    setSelectedBranch("");
    try {
      const repository = await fetchGitHubRepository(repoUrl.trim());
      setPublicRepository(repository);
      setBranches(repository.branches);
      setSelectedBranch(repository.defaultBranch || repository.branches[0]?.name || "");
      setApiError(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not load repository branches.");
    } finally {
      setLoadingBranches(false);
    }
  };

  const handleAdd = async () => {
    const selected = importMode === "github" ? selectedRepo : publicRepository;
    const url = selected?.url || repoUrl.trim();
    if (!url) return;
    setImporting(true);
    try {
      const p = await createProject(url, selectedBranch || selected?.defaultBranch || undefined);
      setProjects((prev) => [p, ...prev.filter((item) => item.id !== p.id)]);
      setRepoUrl("");
      setSelectedRepo(null);
      setPublicRepository(null);
      setBranches([]);
      setSelectedBranch("");
      setShowForm(false);
      setApiError(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not import repository.");
    } finally {
      setImporting(false);
    }
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
        <div>
          <h1>Projects</h1>
          <p className="muted" style={{ margin: "5px 0 0" }}>Dependency risk, advisory evidence, and scan history from saved repository snapshots.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
          + Import Repository
        </button>
      </div>

      <div className="connection-status"><span className={`status-dot ${liveStatus === "connected" ? "status-dot-live" : ""}`} /> Live updates {liveStatus === "connected" ? "connected" : "reconnecting"}</div>
      {apiError && <div className="error-banner">{apiError}</div>}

      {showForm && (
        <div className="card import-card" style={{ marginBottom: 20 }}>
          <h3>Import GitHub Repository</h3>
          <p className="muted" style={{ margin: "4px 0 12px" }}>
            Choose a repository and branch. The default branch is detected from GitHub automatically.
          </p>
          {githubNotice && <p className="muted" role="status">{githubNotice}</p>}
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button className={`btn ${importMode === "github" ? "btn-primary" : "btn-ghost"}`} onClick={() => setImportMode("github")}>My GitHub Repositories</button>
            <button className={`btn ${importMode === "url" ? "btn-primary" : "btn-ghost"}`} onClick={() => setImportMode("url")}>Public Repository URL</button>
          </div>

          {importMode === "github" && (
            <div>
              {!githubAuth?.authenticated ? (
                <div>
                  <p className="muted">Connect GitHub to browse your repositories, including private repositories you can access.</p>
                  {githubAuth?.configured ? (
                    <button className="btn btn-primary" onClick={startGitHubLogin}>Continue with GitHub</button>
                  ) : (
                    <p className="muted">Set up a GitHub OAuth App and add its client ID, secret, and callback URL to backend/.env.</p>
                  )}
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                    {githubAuth.user?.avatarUrl && <img src={githubAuth.user.avatarUrl} alt="" width="28" height="28" style={{ borderRadius: "50%" }} />}
                    <span>Connected as <strong>{githubAuth.user?.login}</strong></span>
                    <button className="btn btn-ghost btn-sm" onClick={() => logoutGitHub().then(() => setGithubAuth((current) => current ? { ...current, authenticated: false, user: null } : current))}>Disconnect</button>
                  </div>
                  <input className="input" placeholder="Filter repositories" value={repoSearch} onChange={(event) => setRepoSearch(event.target.value)} style={{ marginBottom: 8 }} />
                  <select className="input" value={selectedRepo?.fullName || ""} onChange={(event) => void chooseGitHubRepo(event.target.value)}>
                    <option value="">Select a repository…</option>
                    {githubRepos.filter((repo) => repo.fullName.toLowerCase().includes(repoSearch.toLowerCase())).map((repo) => (
                      <option value={repo.fullName} key={repo.id}>{repo.private ? "🔒 " : ""}{repo.fullName}</option>
                    ))}
                  </select>
                  {nextRepoPage && <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => void loadMoreGitHubRepos()}>Load more repositories</button>}
                  {selectedRepo && (
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <select className="input" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)} disabled={loadingBranches || branches.length === 0}>
                        {branches.map((branch) => <option value={branch.name} key={branch.name}>{branch.name}{branch.name === selectedRepo.defaultBranch ? " (default)" : ""}</option>)}
                      </select>
                      <button className="btn btn-primary" onClick={() => void handleAdd()} disabled={importing || loadingBranches || !selectedBranch}>{importing ? "Starting…" : "Analyze branch"}</button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {importMode === "url" && (
            <div>
              <div style={{ display: "flex", gap: 8 }}>
                <input className="input" placeholder="https://github.com/expressjs/express" value={repoUrl} onChange={(event) => { setRepoUrl(event.target.value); setPublicRepository(null); setBranches([]); setSelectedBranch(""); }} onKeyDown={(event) => event.key === "Enter" && void loadPublicRepository()} />
                <button className="btn btn-ghost" onClick={() => void loadPublicRepository()} disabled={!repoUrl.trim() || loadingBranches}>{loadingBranches ? "Loading…" : "Load branches"}</button>
              </div>
              {branches.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <select className="input" value={selectedBranch} onChange={(event) => setSelectedBranch(event.target.value)}>
                    {branches.map((branch) => <option value={branch.name} key={branch.name}>{branch.name}{branch.name === publicRepository?.defaultBranch ? " (default)" : ""}</option>)}
                  </select>
                  <button className="btn btn-primary" onClick={() => void handleAdd()} disabled={importing || !selectedBranch}>{importing ? "Starting…" : "Analyze branch"}</button>
                </div>
              )}
              {!publicRepository && <p className="muted" style={{ marginBottom: 0 }}>For a private repository, connect GitHub and import it from your repository list.</p>}
            </div>
          )}
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

      {projects.length === 0 && !apiError && (
        <div className="empty-state">
          <span className="empty-icon">🛡️</span>
          <h2>No Projects Yet</h2>
          <p className="muted">Import a GitHub repository to start analyzing its supply chain.</p>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ Import Repository</button>
        </div>
      )}
    </div>
  );
}
