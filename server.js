import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import { cloneAndAnalyze, flattenForDb, countNodes, countSignals } from "./utils/analyzer.js";
import {
  getDb,
  dbSaveProject,
  dbUpdateProject,
  dbGetProjects,
  dbGetProject,
  dbDeleteProject,
  dbSaveScan,
  dbGetScansForProject,
  dbGetLatestScanForProject,
  dbGetGlobalStats,
} from "./utils/db.js";
import {
  flattenToFeatureMatrix,
  calculateDatasetStats,
  generateRiskDistribution,
  calculateCorrelationMatrix,
  convertToCSV,
  prepareMlStats,
} from "./utils/dataset_exporter.js";

const app = express();
app.use(express.json());
app.use(cors());

// ─── Initialize DB ───────────────────────────────────────────────────────────
const db = getDb();
if (db) {
  console.log("[Server] Database connected.");
} else {
  console.warn("[Server] Running without database. Set DATABASE_URL in .env to enable persistence.");
}

// ─── In-memory fallback (for when DB is not available) ───────────────────────
let nextProjectId = 4;
const inMemoryProjects = [
  {
    id: 1,
    name: "my-ecommerce-app",
    repoUrl: "https://github.com/acme/my-ecommerce-app",
    branch: "main",
    ecosystem: "npm",
    status: "success",
    riskLevel: "medium",
    lastScanAt: "2026-03-12T08:30:00Z",
    createdAt: "2026-02-15T10:00:00Z",
  },
  {
    id: 2,
    name: "payment-service",
    repoUrl: "https://github.com/acme/payment-service",
    branch: "main",
    ecosystem: "npm",
    status: "warning",
    riskLevel: "high",
    lastScanAt: "2026-03-12T07:00:00Z",
    createdAt: "2026-01-20T14:00:00Z",
  },
  {
    id: 3,
    name: "dashboard-ui",
    repoUrl: "https://github.com/acme/dashboard-ui",
    branch: "develop",
    ecosystem: "npm",
    status: "success",
    riskLevel: "low",
    lastScanAt: "2026-03-11T22:00:00Z",
    createdAt: "2026-03-01T09:00:00Z",
  },
];

// ─── Mock dependency trees (fallback) ────────────────────────────────────────
const dependencyTrees = {
  1: {
    id: "my-ecommerce-app", name: "my-ecommerce-app", version: "1.0.0",
    riskScore: 35, riskLevel: "medium",
    children: [
      {
        id: "react", name: "react", version: "18.2.0", riskScore: 5, riskLevel: "low", signals: [], children: [
          {
            id: "loose-envify", name: "loose-envify", version: "1.4.0", riskScore: 8, riskLevel: "low", signals: ["outdated"], children: [
              { id: "js-tokens", name: "js-tokens", version: "4.0.0", riskScore: 3, riskLevel: "low", signals: [], children: [] },
            ]
          },
        ]
      },
      {
        id: "express", name: "express", version: "4.19.2", riskScore: 12, riskLevel: "low", signals: [], children: [
          { id: "body-parser", name: "body-parser", version: "1.20.2", riskScore: 10, riskLevel: "low", signals: [], children: [] },
          { id: "path-to-regexp", name: "path-to-regexp", version: "0.1.7", riskScore: 42, riskLevel: "medium", signals: ["outdated", "few-maintainers", "known-vulnerability"], children: [] },
        ]
      },
      { id: "lodash.includes", name: "lodash.includes", version: "4.3.0", riskScore: 55, riskLevel: "high", signals: ["deprecated", "unmaintained", "few-maintainers"], children: [] },
    ],
  },
  2: {
    id: "payment-service", name: "payment-service", version: "2.1.0",
    riskScore: 68, riskLevel: "high",
    children: [
      { id: "crypto-js", name: "crypto-js", version: "4.1.1", riskScore: 72, riskLevel: "high", signals: ["known-vulnerability", "unmaintained", "deprecated"], children: [] },
      {
        id: "axios", name: "axios", version: "0.21.1", riskScore: 60, riskLevel: "high", signals: ["known-vulnerability", "outdated"], children: [
          { id: "follow-redirects", name: "follow-redirects", version: "1.14.0", riskScore: 65, riskLevel: "high", signals: ["known-vulnerability"], children: [] },
        ]
      },
    ],
  },
  3: {
    id: "dashboard-ui", name: "dashboard-ui", version: "0.5.0",
    riskScore: 15, riskLevel: "low",
    children: [
      { id: "react-3", name: "react", version: "19.0.0", riskScore: 3, riskLevel: "low", signals: [], children: [] },
      { id: "zustand", name: "zustand", version: "5.0.0", riskScore: 6, riskLevel: "low", signals: [], children: [] },
      { id: "vite-3", name: "vite", version: "6.0.0", riskScore: 4, riskLevel: "low", signals: [], children: [] },
    ],
  },
};

const riskSignals = {
  1: [
    { package: "lodash.includes", signal: "deprecated", severity: "high", description: "Package is deprecated by maintainer" },
    { package: "lodash.includes", signal: "unmaintained", severity: "high", description: "No updates in over 3 years" },
    { package: "path-to-regexp", signal: "known-vulnerability", severity: "high", description: "CVE-2024-45296: ReDoS vulnerability" },
    { package: "path-to-regexp", signal: "outdated", severity: "medium", description: "Current: 0.1.7, Latest: 8.0.0" },
  ],
  2: [
    { package: "crypto-js", signal: "known-vulnerability", severity: "critical", description: "CVE-2023-46233: PBKDF2 weakness" },
    { package: "crypto-js", signal: "unmaintained", severity: "high", description: "Archived by maintainer" },
    { package: "axios", signal: "known-vulnerability", severity: "high", description: "CVE-2023-45857: CSRF token exposure" },
    { package: "follow-redirects", signal: "known-vulnerability", severity: "high", description: "CVE-2024-28849: Authorization header leak" },
  ],
  3: [
    { package: "vite", signal: "info", severity: "low", description: "All dependencies up to date" },
  ],
};

let nextPipelineId = 100;
const pipelines = [
  {
    id: 1, projectId: 1, trigger: "push", branch: "main", commit: "a1b2c3d", status: "success",
    steps: [
      { name: "Clone & Install", status: "success", duration: "12s" },
      { name: "SBOM Generation", status: "success", duration: "8s" },
      { name: "Dependency Extraction", status: "success", duration: "3s" },
      { name: "Graph Construction", status: "success", duration: "2s" },
      { name: "Risk Signal Analysis", status: "success", duration: "15s" },
      { name: "ML Anomaly Detection", status: "success", duration: "6s" },
      { name: "Report Generation", status: "success", duration: "2s" },
    ],
    riskSummary: { critical: 0, high: 2, medium: 5, low: 12 },
    decision: "warn",
    startedAt: "2026-03-12T08:30:00Z",
    finishedAt: "2026-03-12T08:31:06Z",
  },
];

// ─── Helper ──────────────────────────────────────────────────────────────────
const collectSignals = (node, allSignals = []) => {
  if (!node) return allSignals;
  if (node.signals && node.signals.length > 0) {
    node.signals.forEach((s) => {
      if (typeof s === "string") {
        allSignals.push({
          package: node.name,
          signal: s,
          severity: s === "deprecated" || s === "known-vulnerability" ? "high" : s === "unmaintained" || s === "no-repository" ? "medium" : "low",
          description: `Detected: ${s} in ${node.name}@${node.version || "?"}`,
          isAnomaly: node.isAnomaly || false,
          anomalyScore: node.anomalyScore || 0,
        });
      } else {
        allSignals.push({ ...s, isAnomaly: node.isAnomaly || false, anomalyScore: node.anomalyScore || 0 });
      }
    });
  }
  if (node.children) {
    node.children.forEach((child) => collectSignals(child, allSignals));
  }
  return allSignals;
};

// ─── API Routes ──────────────────────────────────────────────────────────────

// GET all projects
app.get("/api/projects", async (_req, res) => {
  if (db) {
    const rows = await dbGetProjects();
    return res.json(rows);
  }
  res.json(inMemoryProjects);
});

// GET single project
app.get("/api/projects/:id", async (req, res) => {
  const projectId = Number(req.params.id);
  if (db) {
    const row = await dbGetProject(projectId);
    if (!row) return res.status(404).json({ error: "Project not found" });
    return res.json(row);
  }
  const project = inMemoryProjects.find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

// POST create/import project
app.post("/api/projects", async (req, res) => {
  const { repoUrl, branch, ecosystem } = req.body;
  if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });

  const name = repoUrl.split("/").pop().replace(".git", "") || "unknown-repo";
  const projectData = {
    name,
    repoUrl,
    branch: branch || "main",
    ecosystem: ecosystem || "npm",
    status: "pending",
    riskLevel: "unknown",
  };

  let newProject;
  if (db) {
    newProject = await dbSaveProject(projectData);
    if (!newProject) {
      // fallback to in-memory
      newProject = { id: nextProjectId++, ...projectData, lastScanAt: null, createdAt: new Date().toISOString() };
    }
  } else {
    newProject = { id: nextProjectId++, ...projectData, lastScanAt: null, createdAt: new Date().toISOString() };
    inMemoryProjects.push(newProject);
  }

  res.status(201).json(newProject);

  // Run analysis in background
  const pid = newProject.id;
  console.log(`[Server] Starting analysis for project ${pid}: ${repoUrl}`);
  try {
    if (db) await dbUpdateProject(pid, { status: "running" });
    else newProject.status = "running";

    const result = await cloneAndAnalyze(repoUrl, pid);

    const updates = {
      status: "success",
      lastScanAt: new Date(),
      riskLevel: result.riskLevel || "low",
      ecosystem: result.scanMeta?.ecosystem || "npm",
    };

    if (db) {
      await dbUpdateProject(pid, updates);

      // Save scan to DB
      const flatPkgs = flattenForDb(result);
      await dbSaveScan(
        {
          projectId: pid,
          repoUrl,
          ecosystem: result.scanMeta?.ecosystem || "npm",
          overallRiskScore: result.riskScore || 0,
          riskLevel: result.riskLevel || "low",
          totalDeps: result.scanMeta?.totalDeps || 0,
          totalSignals: result.scanMeta?.totalSignals || 0,
          totalAnomalies: result.scanMeta?.totalAnomalies || 0,
          scanDurationMs: result.scanMeta?.scanDurationMs || 0,
          mlStats: result.mlStats || null,
        },
        flatPkgs
      );
    } else {
      Object.assign(newProject, updates);
    }

    console.log(`[Server] ✓ Project ${pid} analysis completed.`);
  } catch (error) {
    console.error(`[Server] ✗ Project ${pid} analysis failed:`, error.message);
    if (db) await dbUpdateProject(pid, { status: "failed" });
    else newProject.status = "failed";
  }
});

// DELETE project
app.delete("/api/projects/:id", async (req, res) => {
  const projectId = Number(req.params.id);
  if (db) {
    await dbDeleteProject(projectId);
  } else {
    const idx = inMemoryProjects.findIndex((p) => p.id === projectId);
    if (idx !== -1) inMemoryProjects.splice(idx, 1);
  }
  // Also remove data file
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) await fs.remove(dataFile);
  res.json({ ok: true });
});

// GET pipelines for a project
app.get("/api/projects/:id/pipelines", (req, res) => {
  const projectId = Number(req.params.id);
  res.json(pipelines.filter((p) => p.projectId === projectId));
});

// POST trigger a new scan/pipeline
app.post("/api/projects/:id/scan", async (req, res) => {
  const projectId = Number(req.params.id);

  let project;
  if (db) {
    project = await dbGetProject(projectId);
  } else {
    project = inMemoryProjects.find((p) => p.id === projectId);
  }
  if (!project) return res.status(404).json({ error: "Project not found" });

  const newPipeline = {
    id: nextPipelineId++,
    projectId,
    trigger: "manual",
    branch: project.branch || "main",
    commit: Math.random().toString(36).substring(2, 9),
    status: "running",
    steps: [
      { name: "Clone & Install", status: "running", duration: "..." },
      { name: "SBOM Generation", status: "pending", duration: "-" },
      { name: "Dependency Extraction", status: "pending", duration: "-" },
      { name: "Graph Construction", status: "pending", duration: "-" },
      { name: "Risk Signal Analysis", status: "pending", duration: "-" },
      { name: "ML Anomaly Detection", status: "pending", duration: "-" },
      { name: "Report Generation", status: "pending", duration: "-" },
    ],
    riskSummary: null,
    decision: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  pipelines.push(newPipeline);
  res.status(201).json(newPipeline);

  // Run real analysis in background
  try {
    const result = await cloneAndAnalyze(project.repoUrl, projectId);

    newPipeline.status = "success";
    newPipeline.finishedAt = new Date().toISOString();
    newPipeline.steps = newPipeline.steps.map((s) => ({
      ...s,
      status: "success",
      duration: Math.floor(Math.random() * 15 + 2) + "s",
    }));

    const signals = collectSignals(result);
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    signals.forEach((s) => {
      if (counts[s.severity] !== undefined) counts[s.severity]++;
    });
    newPipeline.riskSummary = counts;
    newPipeline.decision = counts.critical > 0 ? "block" : counts.high > 2 ? "warn" : "pass";

    if (db) {
      await dbUpdateProject(projectId, {
        status: "success",
        lastScanAt: new Date(),
        riskLevel: result.riskLevel || "low",
      });
      const flatPkgs = flattenForDb(result);
      await dbSaveScan(
        {
          projectId,
          repoUrl: project.repoUrl,
          ecosystem: result.scanMeta?.ecosystem || "npm",
          overallRiskScore: result.riskScore || 0,
          riskLevel: result.riskLevel || "low",
          totalDeps: result.scanMeta?.totalDeps || 0,
          totalSignals: result.scanMeta?.totalSignals || 0,
          totalAnomalies: result.scanMeta?.totalAnomalies || 0,
          scanDurationMs: result.scanMeta?.scanDurationMs || 0,
          mlStats: result.mlStats || null,
        },
        flatPkgs
      );
    }
  } catch (err) {
    newPipeline.status = "failed";
    newPipeline.finishedAt = new Date().toISOString();
    newPipeline.steps = newPipeline.steps.map((s) => ({
      ...s,
      status: s.status === "pending" ? "skipped" : s.status === "running" ? "failed" : s.status,
    }));
    console.error(`[Server] Scan failed for project ${projectId}:`, err.message);
  }
});

// GET dependency tree for a project
app.get("/api/projects/:id/dependencies", async (req, res) => {
  const projectId = Number(req.params.id);
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    return res.json(await fs.readJson(dataFile));
  }
  const tree = dependencyTrees[projectId];
  if (!tree) return res.status(404).json({ error: "No dependency data found. Try running a scan." });
  res.json(tree);
});

// GET risk signals for a project
app.get("/api/projects/:id/signals", async (req, res) => {
  const projectId = Number(req.params.id);
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const tree = await fs.readJson(dataFile);
    return res.json(collectSignals(tree));
  }
  res.json(riskSignals[projectId] || []);
});

// GET risk summary for a project
app.get("/api/projects/:id/risk", async (req, res) => {
  const projectId = Number(req.params.id);
  let tree, signals;

  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    tree = await fs.readJson(dataFile);
    signals = collectSignals(tree);
  } else {
    tree = dependencyTrees[projectId];
    signals = riskSignals[projectId] || [];
  }
  if (!tree) return res.status(404).json({ error: "No data" });

  function countN(node) {
    let c = 0;
    for (const ch of node.children || []) c += 1 + countN(ch);
    return c;
  }

  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  signals.forEach((s) => {
    const sev = typeof s === "object" && s.severity ? s.severity : "medium";
    if (severityCounts[sev] !== undefined) severityCounts[sev]++;
  });

  res.json({
    projectName: tree.name,
    overallRiskScore: tree.riskScore || 0,
    overallRiskLevel: tree.riskLevel || "unknown",
    totalDependencies: countN(tree),
    signalCounts: severityCounts,
    totalSignals: signals.length,
  });
});

// GET ML stats for a project
app.get("/api/projects/:id/ml-stats", async (req, res) => {
  const projectId = Number(req.params.id);

  // First try data file
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const data = await fs.readJson(dataFile);
    if (data.mlStats) return res.json(data.mlStats);
  }

  // Try DB
  if (db) {
    const scan = await dbGetLatestScanForProject(projectId);
    if (scan && scan.mlStats) return res.json(scan.mlStats);
  }

  res.status(404).json({ error: "No ML stats available. Run a scan first." });
});

// GET scan history for a project
app.get("/api/projects/:id/history", async (req, res) => {
  const projectId = Number(req.params.id);
  if (db) {
    const scanHistory = await dbGetScansForProject(projectId);
    return res.json(scanHistory);
  }
  res.json([]);
});

// GET global stats
app.get("/api/stats/global", async (_req, res) => {
  if (db) {
    const stats = await dbGetGlobalStats();
    return res.json(stats || { totalScans: 0, totalAnomalies: 0, avgRiskScore: 0, totalPackagesAnalyzed: 0 });
  }
  res.json({ totalScans: 0, totalAnomalies: 0, avgRiskScore: 0, totalPackagesAnalyzed: 0 });
});

// ─── Dataset Export Endpoints ────────────────────────────────────────────────

// GET dataset for a project (feature matrix + stats)
app.get("/api/projects/:id/dataset", async (req, res) => {
  const projectId = Number(req.params.id);

  // First try data file
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const tree = await fs.readJson(dataFile);
    const featureMatrix = flattenToFeatureMatrix(tree);
    const stats = calculateDatasetStats(featureMatrix);

    return res.json({
      featureMatrix,
      stats,
      projectId,
      timestamp: new Date().toISOString(),
    });
  }

  // Try DB
  if (db) {
    const scan = await dbGetLatestScanForProject(projectId);
    if (scan && scan.mlStats && scan.mlStats.featureMatrix) {
      const stats = calculateDatasetStats(scan.mlStats.featureMatrix);
      return res.json({
        featureMatrix: scan.mlStats.featureMatrix,
        stats,
        projectId,
        timestamp: scan.created_at,
      });
    }
  }

  // Fallback to mock data
  if (dependencyTrees[projectId]) {
    const tree = dependencyTrees[projectId];
    const featureMatrix = flattenToFeatureMatrix(tree);
    const stats = calculateDatasetStats(featureMatrix);

    return res.json({
      featureMatrix,
      stats,
      projectId,
      timestamp: new Date().toISOString(),
    });
  }

  res.status(404).json({ error: "No dataset available" });
});

// GET dataset stats for a project
app.get("/api/projects/:id/dataset/stats", async (req, res) => {
  const projectId = Number(req.params.id);

  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const tree = await fs.readJson(dataFile);
    const featureMatrix = flattenToFeatureMatrix(tree);
    const stats = calculateDatasetStats(featureMatrix);
    const riskDistribution = generateRiskDistribution(featureMatrix);

    return res.json({
      stats,
      riskDistribution,
      totalPackages: featureMatrix.length,
    });
  }

  // Fallback
  if (dependencyTrees[projectId]) {
    const tree = dependencyTrees[projectId];
    const featureMatrix = flattenToFeatureMatrix(tree);
    const stats = calculateDatasetStats(featureMatrix);
    const riskDistribution = generateRiskDistribution(featureMatrix);

    return res.json({
      stats,
      riskDistribution,
      totalPackages: featureMatrix.length,
    });
  }

  res.status(404).json({ error: "No dataset available" });
});

// GET dataset visualizations (correlation matrix, etc.)
app.get("/api/projects/:id/dataset/correlations", async (req, res) => {
  const projectId = Number(req.params.id);

  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const tree = await fs.readJson(dataFile);
    const featureMatrix = flattenToFeatureMatrix(tree);
    const correlations = calculateCorrelationMatrix(featureMatrix);

    return res.json(correlations);
  }

  // Fallback
  if (dependencyTrees[projectId]) {
    const tree = dependencyTrees[projectId];
    const featureMatrix = flattenToFeatureMatrix(tree);
    const correlations = calculateCorrelationMatrix(featureMatrix);

    return res.json(correlations);
  }

  res.status(404).json({ error: "No dataset available" });
});

// GET dataset export as CSV
app.get("/api/projects/:id/dataset/export", async (req, res) => {
  const projectId = Number(req.params.id);
  const format = req.query.format || "csv";

  const dataFile = path.resolve("data", `${projectId}.json`);
  let featureMatrix;

  if (await fs.pathExists(dataFile)) {
    const tree = await fs.readJson(dataFile);
    featureMatrix = flattenToFeatureMatrix(tree);
  } else if (dependencyTrees[projectId]) {
    featureMatrix = flattenToFeatureMatrix(dependencyTrees[projectId]);
  } else {
    return res.status(404).json({ error: "No dataset available" });
  }

  if (format === "csv") {
    const csv = convertToCSV(featureMatrix);
    const filename = `dataset_${projectId}_${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } else if (format === "json") {
    const filename = `dataset_${projectId}_${new Date().toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(featureMatrix);
  } else {
    res.status(400).json({ error: "Invalid format. Use 'csv' or 'json'" });
  }
});

// GitHub webhook
app.post("/api/github-webhook", (req, res) => {
  const event = req.headers["x-github-event"];
  console.log(`[Webhook] Received event: ${event}`);
  if (event === "push") {
    console.log("[CI] Triggering supply chain analysis pipeline...");
  }
  res.sendStatus(200);
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n🛡️  Supply Chain CI/CD Backend running on http://localhost:${PORT}`);
  console.log(`   Database: ${db ? "✓ Connected (Supabase)" : "✗ Not connected (using in-memory)"}\n`);
});
