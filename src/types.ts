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
  // ML fields
  anomalyScore?: number;
  isAnomaly?: boolean;
  pagerank?: number;
  centrality?: number;
  blastRadius?: number;
  maintainerCount?: number;
  ageDays?: number;
  daysSinceUpdate?: number;
  // Extra
  mlStats?: MLStats;
  edges?: GraphEdge[];
  scanMeta?: ScanMeta;
}

export interface RiskSignal {
  package: string;
  signal: string;
  severity: string;
  description: string;
  isAnomaly?: boolean;
  anomalyScore?: number;
}

export interface RiskSummary {
  projectName: string;
  overallRiskScore: number;
  overallRiskLevel: string;
  totalDependencies: number;
  signalCounts: { critical: number; high: number; medium: number; low: number };
  totalSignals: number;
}

// ─── ML Types ────────────────────────────────────────────────────────────────

export interface FeatureRow {
  name: string;
  version: string;
  maintainerCount: number;
  ageDays: number;
  daysSinceUpdate: number;
  depth: number;
  blastRadius: number;
  pagerank: number;
  centrality: number;
  riskScore: number;
  anomalyScore: number;
  isAnomaly: boolean;
}

export interface MLStats {
  featureNames: string[];
  featureMatrix: FeatureRow[];
  correlationMatrix: number[][];
  featureImportances: Record<string, number>;
  riskDistribution: { bin: string; count: number }[];
  totalAnomalies: number;
  totalPackages: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface ScanMeta {
  ecosystem: string;
  scanDurationMs: number;
  totalDeps: number;
  totalSignals: number;
  totalAnomalies: number;
  scannedAt: string;
}

// ─── History Types ───────────────────────────────────────────────────────────

export interface ScanHistoryEntry {
  id: number;
  projectId: number;
  repoUrl: string;
  commitHash: string | null;
  ecosystem: string;
  overallRiskScore: number;
  riskLevel: string;
  totalDeps: number;
  totalSignals: number;
  totalAnomalies: number;
  scanDurationMs: number;
  mlStats: MLStats | null;
  createdAt: string;
}

export interface GlobalStats {
  totalScans: number;
  totalAnomalies: number;
  avgRiskScore: number;
  totalPackagesAnalyzed: number;
}
