import type { Project, Pipeline, DepNode, RiskSignal, RiskSummary, MLStats, ScanHistoryEntry, GlobalStats, AuditEvent, FeatureRow, DatasetStatistics, CycloneDxSbom } from "./types";

const API = (import.meta.env.VITE_API_URL || "http://localhost:3001/api").replace(/\/+$/, "");

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { credentials: "include", ...init });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    let message = detail || `Request failed (${response.status})`;
    try { message = JSON.parse(detail).error || message; } catch { /* keep the response text */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export interface LiveUpdate {
  type: string;
  status?: "connected" | "reconnecting";
  projectId?: number;
  pipeline?: Pipeline;
  project?: Partial<Project>;
}

export function subscribeToUpdates(onUpdate: (update: LiveUpdate) => void): () => void {
  const source = new EventSource(`${API}/events`);
  source.addEventListener("open", () => onUpdate({ type: "connection", status: "connected" }));
  source.addEventListener("error", () => onUpdate({ type: "connection", status: "reconnecting" }));
  source.addEventListener("update", (event) => {
    try { onUpdate(JSON.parse((event as MessageEvent).data) as LiveUpdate); } catch { /* ignore malformed event */ }
  });
  return () => source.close();
}

export async function fetchProjects(): Promise<Project[]> {
  return request<Project[]>("/projects");
}

export async function fetchProject(id: number): Promise<Project> {
  return request<Project>(`/projects/${id}`);
}

export async function createProject(repoUrl: string, branch?: string): Promise<Project> {
  return request<Project>("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, branch }),
  });
}

export interface GitHubAuthStatus {
  configured: boolean;
  authenticated: boolean;
  user: { login: string; name: string; avatarUrl: string } | null;
}

export interface GitHubRepository {
  id: number;
  name: string;
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  description?: string | null;
}

export interface GitHubBranch {
  name: string;
  protected: boolean;
}

export async function fetchGitHubAuthStatus(): Promise<GitHubAuthStatus> {
  return request<GitHubAuthStatus>("/auth/github/status");
}

export async function logoutGitHub(): Promise<void> {
  await request<{ ok: boolean }>("/auth/github/logout", { method: "POST" });
}

export function startGitHubLogin(): void {
  window.location.assign(`${API}/auth/github/start`);
}

export async function fetchGitHubRepos(page = 1): Promise<{ repos: GitHubRepository[]; nextPage: number | null }> {
  return request<{ repos: GitHubRepository[]; nextPage: number | null }>(`/github/repos?page=${page}`);
}

export async function fetchGitHubBranches(fullName: string): Promise<GitHubBranch[]> {
  const [owner, repo] = fullName.split("/");
  return request(`/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`);
}

export async function fetchGitHubRepository(url: string): Promise<GitHubRepository & { branches: GitHubBranch[] }> {
  return request(`/github/repository?url=${encodeURIComponent(url)}`);
}

export async function deleteProject(id: number): Promise<void> {
  await request<{ ok: boolean }>(`/projects/${id}`, { method: "DELETE" });
}

export async function fetchPipelines(projectId: number): Promise<Pipeline[]> {
  return request<Pipeline[]>(`/projects/${projectId}/pipelines`);
}

export async function triggerScan(projectId: number): Promise<Pipeline> {
  return request<Pipeline>(`/projects/${projectId}/scan`, { method: "POST" });
}

export async function fetchDependencyTree(projectId: number): Promise<DepNode> {
  return request<DepNode>(`/projects/${projectId}/dependencies`);
}

export async function fetchRiskSignals(projectId: number): Promise<RiskSignal[]> {
  return request<RiskSignal[]>(`/projects/${projectId}/signals`);
}

export async function fetchRiskSummary(projectId: number): Promise<RiskSummary> {
  return request<RiskSummary>(`/projects/${projectId}/risk`);
}

export async function fetchMLStats(projectId: number): Promise<MLStats> {
  return request<MLStats>(`/projects/${projectId}/ml-stats`);
}

export async function fetchSbom(projectId: number): Promise<CycloneDxSbom> {
  return request<CycloneDxSbom>(`/projects/${projectId}/sbom`);
}

export async function fetchScanHistory(projectId: number): Promise<ScanHistoryEntry[]> {
  return request<ScanHistoryEntry[]>(`/projects/${projectId}/history`);
}

export async function fetchAuditEvents(projectId: number): Promise<AuditEvent[]> {
  return request<AuditEvent[]>(`/audit?projectId=${projectId}&limit=500`);
}

export async function fetchGlobalStats(): Promise<GlobalStats> {
  return request<GlobalStats>("/stats/global");
}

// ─── Dataset Export Endpoints ────────────────────────────────────────────────

export async function fetchDataset(projectId: number): Promise<{ featureMatrix: FeatureRow[]; stats: DatasetStatistics; projectId: number; timestamp: string }> {
  return request(`/projects/${projectId}/dataset`);
}

export async function fetchDatasetStats(projectId: number): Promise<{ stats: DatasetStatistics; riskDistribution: { bin: string; count: number }[]; totalPackages: number }> {
  return request(`/projects/${projectId}/dataset/stats`);
}

export async function fetchCorrelationMatrix(projectId: number): Promise<Record<string, Record<string, number>>> {
  return request(`/projects/${projectId}/dataset/correlations`);
}

export async function exportDataset(projectId: number, format: "csv" | "json" = "csv") {
  const res = await fetch(`${API}/projects/${projectId}/dataset/export?format=${format}`);
  if (!res.ok) throw new Error("Failed to export dataset");

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dataset_${projectId}.${format}`;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
}

export function downloadSbom(projectId: number): void {
  const link = document.createElement("a");
  link.href = `${API}/projects/${projectId}/sbom?download=true`;
  link.download = `project-${projectId}.sbom.cdx.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
