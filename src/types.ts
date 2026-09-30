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
  error?: string;
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
  error?: string | null;
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
  packageVersion?: string;
  rootDependency?: string;
  signal: string;
  severity: string;
  description: string;
  isAnomaly?: boolean;
  anomalyScore?: number;
  source?: string;
  references?: string[];
  file?: string;
  line?: number;
  snippet?: string;
}

export interface CycloneDxSbom {
  bomFormat: string;
  specVersion: string;
  serialNumber?: string;
  version: number;
  metadata?: {
    timestamp?: string;
    component?: { name?: string; version?: string };
    properties?: Array<{ name: string; value: string }>;
  };
  components: Array<{ name: string; version?: string; type?: string; purl?: string; licenses?: Array<{ license?: { name?: string } }> }>;
  vulnerabilities?: Array<{ id: string; description?: string; ratings?: Array<{ severity?: string }>; affects?: Array<{ ref: string }>; references?: Array<{ id: string }> }>;
}

export interface RiskSummary {
  projectName: string;
  overallRiskScore: number;
  overallRiskLevel: string;
  totalDependencies: number;
  signalCounts: { critical: number; high: number; medium: number; low: number };
  totalSignals: number;
  sourceFilesScanned?: number;
  sourceFindingCount?: number;
  vulnerabilityScanStatus?: string;
}

// ─── ML Types ────────────────────────────────────────────────────────────────

export interface FeatureRow {
  name: string;
  version: string;
  maintainerCount: number | null;
  ageDays: number | null;
  daysSinceUpdate: number | null;
  depth: number;
  blastRadius: number;
  pagerank: number;
  centrality: number;
  riskScore: number;
  anomalyScore: number;
  isAnomaly: boolean;
  anomalyReasons?: string[];
}

export interface MLStats {
  featureNames: string[];
  featureMatrix: FeatureRow[];
  correlationMatrix: number[][];
  featureImportances: Record<string, number>;
  featureSpread?: Record<string, number>;
  featureCoverage?: Record<string, number>;
  evaluation?: {
    method: string;
    labelledGroundTruthAvailable: boolean;
    status: string;
    scoredSamples: number;
    flaggedSamples?: number;
    anomalyRate?: number;
    scoreRange?: number[];
    minimumSamples?: number;
  };
  riskDistribution: { bin: string; count: number }[];
  totalAnomalies: number;
  totalPackages: number;
}

export interface DatasetStatistics {
  total_packages: number;
  total_anomalies: number;
  anomaly_percentage: number;
  anomaly_score_mean: number;
  anomaly_score_std: number;
  anomaly_score_min: number;
  anomaly_score_max: number;
  avg_package_age_days: number | null;
  avg_maintainer_count: number | null;
  top_anomalies?: FeatureRow[];
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
  vulnerabilityScanStatus?: string;
  sourceFilesScanned?: number;
  sourceFindingCount?: number;
}

// ─── History Types ───────────────────────────────────────────────────────────

export interface ScanHistoryEntry {
  id: number;
  projectId: number;
  pipelineId?: number | null;
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

export interface AuditEvent {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
  projectId?: number;
  pipelineId?: number;
  trigger?: string;
  repoUrl?: string;
  branch?: string;
  commitHash?: string;
  stage?: string;
  status?: string;
  duration?: string;
  riskLevel?: string;
  riskScore?: number;
  totalDeps?: number;
  totalSignals?: number;
  totalAnomalies?: number;
  scanDurationMs?: number;
  decision?: string;
  format?: string;
  rows?: number;
  error?: string;
  previousHash?: string;
  eventHash?: string;
  integrity?: "valid" | "invalid" | "unverified";
}

export interface GlobalStats {
  totalScans: number;
  totalAnomalies: number;
  avgRiskScore: number;
  totalPackagesAnalyzed: number;
}
