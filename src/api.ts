import type { Project, Pipeline, DepNode, RiskSignal, RiskSummary } from "./types";

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
