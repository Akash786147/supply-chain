export interface Project {
  id: number;
  name: string;
  repoUrl: string;
  branch: string;
  ecosystem: string;
  status: string;
  riskLevel: string;
  lastScanAt: string | null;
  createdAt: string;
}

export interface PipelineStep {
  name: string;
  status: string;
  duration: string;
}

export interface Pipeline {
  id: number;
  projectId: number;
  trigger: string;
  branch: string;
  commit: string;
  status: string;
  steps: PipelineStep[];
  riskSummary: { critical: number; high: number; medium: number; low: number } | null;
  decision: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DepNode {
  id: string;
  name: string;
  version: string;
  riskScore: number;
  riskLevel: string;
  signals?: string[];
  children: DepNode[];
}

export interface RiskSignal {
  package: string;
  signal: string;
  severity: string;
  description: string;
}

export interface RiskSummary {
  projectName: string;
  overallRiskScore: number;
  overallRiskLevel: string;
  totalDependencies: number;
  signalCounts: { critical: number; high: number; medium: number; low: number };
  totalSignals: number;
}
