import { pgTable, serial, integer, text, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

// ─── Scans Table ─────────────────────────────────────────────────────────────
export const scans = pgTable("scans", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  pipelineId: integer("pipeline_id"),
  repoUrl: text("repo_url").notNull(),
  commitHash: text("commit_hash"),
  ecosystem: text("ecosystem").notNull().default("npm"),
  overallRiskScore: real("overall_risk_score").default(0),
  riskLevel: text("risk_level").default("unknown"),
  totalDeps: integer("total_deps").default(0),
  totalSignals: integer("total_signals").default(0),
  totalAnomalies: integer("total_anomalies").default(0),
  scanDurationMs: integer("scan_duration_ms"),
  mlStats: jsonb("ml_stats"), // feature matrix, correlation, distribution
  scanData: jsonb("scan_data"),
  sbom: jsonb("sbom"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Scan Packages Table ─────────────────────────────────────────────────────
export const scanPackages = pgTable("scan_packages", {
  id: serial("id").primaryKey(),
  scanId: integer("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  version: text("version"),
  ecosystem: text("ecosystem").default("npm"),
  riskScore: real("risk_score").default(0),
  riskLevel: text("risk_level").default("low"),
  anomalyScore: real("anomaly_score"),
  isAnomaly: boolean("is_anomaly").default(false),
  depth: integer("depth").default(0),
  pagerank: real("pagerank"),
  centrality: real("centrality"),
  blastRadius: integer("blast_radius").default(0),
  maintainerCount: integer("maintainer_count"),
  ageDays: integer("age_days"),
  daysSinceUpdate: integer("days_since_update"),
  signalsJson: jsonb("signals_json"), // array of signal strings
  createdAt: timestamp("created_at").defaultNow(),
});

// ─── Projects Table (persistent) ─────────────────────────────────────────────
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  repoUrl: text("repo_url").notNull(),
  branch: text("branch").default("main"),
  ecosystem: text("ecosystem").default("npm"),
  status: text("status").default("pending"),
  riskLevel: text("risk_level").default("unknown"),
  lastScanAt: timestamp("last_scan_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Durable, hash-linked copy of the append-only application audit journal.
export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  projectId: integer("project_id"),
  pipelineId: integer("pipeline_id"),
  action: text("action").notNull(),
  actor: text("actor").notNull(),
  previousHash: text("previous_hash").notNull(),
  eventHash: text("event_hash").notNull(),
  payload: jsonb("payload").notNull(),
});

// Durable record of every pipeline attempt, including in-progress and failed runs.
export const pipelineRuns = pgTable("pipeline_runs", {
  id: integer("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  trigger: text("trigger").notNull(),
  branch: text("branch"),
  commitHash: text("commit_hash"),
  status: text("status").notNull(),
  steps: jsonb("steps").notNull().default([]),
  riskSummary: jsonb("risk_summary"),
  decision: text("decision"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  error: text("error"),
  pipelineData: jsonb("pipeline_data").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
