import type { Project, Pipeline, DepNode, RiskSignal, RiskSummary, MLStats, ScanHistoryEntry, GlobalStats } from "./types";

const API = "http://localhost:3001/api";

export async function fetchProjects(): Promise<Project[]> {
  const res = await fetch(`${API}/projects`);
  return res.json();
}

export async function fetchProject(id: number): Promise<Project> {
  const res = await fetch(`${API}/projects/${id}`);
  return res.json();
}

export async function createProject(repoUrl: string, branch?: string): Promise<Project> {
  const res = await fetch(`${API}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoUrl, branch }),
  });
  return res.json();
}

export async function deleteProject(id: number): Promise<void> {
  await fetch(`${API}/projects/${id}`, { method: "DELETE" });
}

export async function fetchPipelines(projectId: number): Promise<Pipeline[]> {
  const res = await fetch(`${API}/projects/${projectId}/pipelines`);
  return res.json();
}

export async function triggerScan(projectId: number): Promise<Pipeline> {
  const res = await fetch(`${API}/projects/${projectId}/scan`, { method: "POST" });
  return res.json();
}

export async function fetchDependencyTree(projectId: number): Promise<DepNode> {
  const res = await fetch(`${API}/projects/${projectId}/dependencies`);
  return res.json();
}

export async function fetchRiskSignals(projectId: number): Promise<RiskSignal[]> {
  const res = await fetch(`${API}/projects/${projectId}/signals`);
  return res.json();
}

export async function fetchRiskSummary(projectId: number): Promise<RiskSummary> {
  const res = await fetch(`${API}/projects/${projectId}/risk`);
  return res.json();
}

export async function fetchMLStats(projectId: number): Promise<MLStats> {
  const res = await fetch(`${API}/projects/${projectId}/ml-stats`);
  return res.json();
}

export async function fetchScanHistory(projectId: number): Promise<ScanHistoryEntry[]> {
  const res = await fetch(`${API}/projects/${projectId}/history`);
  return res.json();
}

export async function fetchGlobalStats(): Promise<GlobalStats> {
  const res = await fetch(`${API}/stats/global`);
  return res.json();
}

// ─── Dataset Export Endpoints ────────────────────────────────────────────────

export async function fetchDataset(projectId: number) {
  const res = await fetch(`${API}/projects/${projectId}/dataset`);
  return res.json();
}

export async function fetchDatasetStats(projectId: number) {
  const res = await fetch(`${API}/projects/${projectId}/dataset/stats`);
  return res.json();
}

export async function fetchCorrelationMatrix(projectId: number) {
  const res = await fetch(`${API}/projects/${projectId}/dataset/correlations`);
  return res.json();
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
