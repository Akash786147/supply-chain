import express from "express";
import cors from "cors";
import fs from "fs-extra";
import path from "path";
import { cloneAndAnalyze } from "./utils/analyzer.js";

const app = express();
app.use(express.json());
app.use(cors());


let nextProjectId = 4;
let nextPipelineId = 100;

const projects = [
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

const pipelines = [
  {
    id: 1,
    projectId: 1,
    trigger: "push",
    branch: "main",
    commit: "a1b2c3d",
    status: "success",
    steps: [
      { name: "Clone & Install", status: "success", duration: "12s" },
      { name: "SBOM Generation", status: "success", duration: "8s" },
      { name: "Dependency Extraction", status: "success", duration: "3s" },
      { name: "Graph Construction", status: "success", duration: "2s" },
      { name: "Risk Signal Analysis", status: "success", duration: "15s" },
      { name: "Score Computation", status: "success", duration: "4s" },
      { name: "Report Generation", status: "success", duration: "2s" },
    ],
    riskSummary: { critical: 0, high: 2, medium: 5, low: 12 },
    decision: "warn",
    startedAt: "2026-03-12T08:30:00Z",
    finishedAt: "2026-03-12T08:31:06Z",
  },
  {
    id: 2,
    projectId: 1,
    trigger: "push",
    branch: "main",
    commit: "e4f5g6h",
    status: "success",
    steps: [
      { name: "Clone & Install", status: "success", duration: "11s" },
      { name: "SBOM Generation", status: "success", duration: "7s" },
      { name: "Dependency Extraction", status: "success", duration: "3s" },
      { name: "Graph Construction", status: "success", duration: "2s" },
      { name: "Risk Signal Analysis", status: "success", duration: "14s" },
      { name: "Score Computation", status: "success", duration: "3s" },
      { name: "Report Generation", status: "success", duration: "2s" },
    ],
    riskSummary: { critical: 0, high: 1, medium: 4, low: 10 },
    decision: "pass",
    startedAt: "2026-03-11T15:20:00Z",
    finishedAt: "2026-03-11T15:21:02Z",
  },
  {
    id: 3,
    projectId: 2,
    trigger: "push",
    branch: "main",
    commit: "x9y8z7w",
    status: "failed",
    steps: [
      { name: "Clone & Install", status: "success", duration: "14s" },
      { name: "SBOM Generation", status: "success", duration: "9s" },
      { name: "Dependency Extraction", status: "success", duration: "4s" },
      { name: "Graph Construction", status: "success", duration: "2s" },
      { name: "Risk Signal Analysis", status: "success", duration: "18s" },
      { name: "Score Computation", status: "success", duration: "5s" },
      { name: "Report Generation", status: "failed", duration: "1s" },
    ],
    riskSummary: { critical: 2, high: 5, medium: 8, low: 6 },
    decision: "block",
    startedAt: "2026-03-12T07:00:00Z",
    finishedAt: "2026-03-12T07:01:13Z",
  },
];

// Full dependency trees per project
const dependencyTrees = {
  1: {
    id: "my-ecommerce-app",
    name: "my-ecommerce-app",
    version: "1.0.0",
    riskScore: 35,
    riskLevel: "medium",
    children: [
      {
        id: "react",
        name: "react",
        version: "18.2.0",
        riskScore: 5,
        riskLevel: "low",
        signals: [],
        children: [
          {
            id: "loose-envify",
            name: "loose-envify",
            version: "1.4.0",
            riskScore: 8,
            riskLevel: "low",
            signals: ["outdated"],
            children: [
              { id: "js-tokens", name: "js-tokens", version: "4.0.0", riskScore: 3, riskLevel: "low", signals: [], children: [] },
            ],
          },
        ],
      },
      {
        id: "express",
        name: "express",
        version: "4.19.2",
        riskScore: 12,
        riskLevel: "low",
        signals: [],
        children: [
          {
            id: "body-parser",
            name: "body-parser",
            version: "1.20.2",
            riskScore: 10,
            riskLevel: "low",
            signals: [],
            children: [
              { id: "bytes", name: "bytes", version: "3.1.2", riskScore: 4, riskLevel: "low", signals: [], children: [] },
              { id: "raw-body", name: "raw-body", version: "2.5.2", riskScore: 6, riskLevel: "low", signals: [], children: [] },
            ],
          },
          {
            id: "cookie",
            name: "cookie",
            version: "0.6.0",
            riskScore: 15,
            riskLevel: "low",
            signals: ["few-maintainers"],
            children: [],
          },
          {
            id: "path-to-regexp",
            name: "path-to-regexp",
            version: "0.1.7",
            riskScore: 42,
            riskLevel: "medium",
            signals: ["outdated", "few-maintainers", "known-vulnerability"],
            children: [],
          },
        ],
      },
      {
        id: "jsonwebtoken",
        name: "jsonwebtoken",
        version: "9.0.2",
        riskScore: 20,
        riskLevel: "low",
        signals: [],
        children: [
          {
            id: "jws",
            name: "jws",
            version: "3.2.2",
            riskScore: 25,
            riskLevel: "medium",
            signals: ["outdated"],
            children: [
              { id: "jwa", name: "jwa", version: "1.4.1", riskScore: 18, riskLevel: "low", signals: ["outdated"], children: [] },
              {
                id: "safe-buffer",
                name: "safe-buffer",
                version: "5.2.1",
                riskScore: 10,
                riskLevel: "low",
                signals: [],
                children: [],
              },
            ],
          },
          {
            id: "lodash.includes",
            name: "lodash.includes",
            version: "4.3.0",
            riskScore: 55,
            riskLevel: "high",
            signals: ["deprecated", "unmaintained", "micro-package"],
            children: [],
          },
        ],
      },
      {
        id: "stripe",
        name: "stripe",
        version: "14.12.0",
        riskScore: 8,
        riskLevel: "low",
        signals: [],
        children: [
          { id: "qs", name: "qs", version: "6.11.0", riskScore: 7, riskLevel: "low", signals: [], children: [] },
          {
            id: "node-fetch",
            name: "node-fetch",
            version: "2.7.0",
            riskScore: 30,
            riskLevel: "medium",
            signals: ["outdated", "known-vulnerability"],
            children: [
              {
                id: "whatwg-url",
                name: "whatwg-url",
                version: "5.0.0",
                riskScore: 22,
                riskLevel: "medium",
                signals: ["outdated"],
                children: [],
              },
            ],
          },
        ],
      },
    ],
  },
  2: {
    id: "payment-service",
    name: "payment-service",
    version: "2.1.0",
    riskScore: 68,
    riskLevel: "high",
    children: [
      {
        id: "express-2",
        name: "express",
        version: "4.17.1",
        riskScore: 45,
        riskLevel: "medium",
        signals: ["outdated", "known-vulnerability"],
        children: [
          {
            id: "qs-2",
            name: "qs",
            version: "6.7.0",
            riskScore: 52,
            riskLevel: "high",
            signals: ["known-vulnerability", "outdated"],
            children: [],
          },
        ],
      },
      {
        id: "crypto-js",
        name: "crypto-js",
        version: "4.1.1",
        riskScore: 72,
        riskLevel: "high",
        signals: ["known-vulnerability", "unmaintained", "deprecated"],
        children: [],
      },
      {
        id: "axios",
        name: "axios",
        version: "0.21.1",
        riskScore: 60,
        riskLevel: "high",
        signals: ["known-vulnerability", "outdated"],
        children: [
          {
            id: "follow-redirects",
            name: "follow-redirects",
            version: "1.14.0",
            riskScore: 65,
            riskLevel: "high",
            signals: ["known-vulnerability"],
            children: [],
          },
        ],
      },
      {
        id: "uuid-2",
        name: "uuid",
        version: "9.0.0",
        riskScore: 5,
        riskLevel: "low",
        signals: [],
        children: [],
      },
    ],
  },
  3: {
    id: "dashboard-ui",
    name: "dashboard-ui",
    version: "0.5.0",
    riskScore: 15,
    riskLevel: "low",
    children: [
      {
        id: "react-3",
        name: "react",
        version: "19.0.0",
        riskScore: 3,
        riskLevel: "low",
        signals: [],
        children: [
          {
            id: "react-dom-3",
            name: "react-dom",
            version: "19.0.0",
            riskScore: 3,
            riskLevel: "low",
            signals: [],
            children: [{ id: "scheduler", name: "scheduler", version: "0.25.0", riskScore: 3, riskLevel: "low", signals: [], children: [] }],
          },
        ],
      },
      {
        id: "zustand",
        name: "zustand",
        version: "5.0.0",
        riskScore: 6,
        riskLevel: "low",
        signals: [],
        children: [],
      },
      {
        id: "vite-3",
        name: "vite",
        version: "6.0.0",
        riskScore: 4,
        riskLevel: "low",
        signals: [],
        children: [
          { id: "esbuild", name: "esbuild", version: "0.24.0", riskScore: 5, riskLevel: "low", signals: [], children: [] },
          { id: "rollup", name: "rollup", version: "4.28.0", riskScore: 4, riskLevel: "low", signals: [], children: [] },
        ],
      },
    ],
  },
};

// Risk signals database per project
const riskSignals = {
  1: [
    { package: "lodash.includes", signal: "deprecated", severity: "high", description: "Package is deprecated by maintainer" },
    { package: "lodash.includes", signal: "unmaintained", severity: "high", description: "No updates in over 3 years" },
    { package: "lodash.includes", signal: "micro-package", severity: "medium", description: "Single-function package — high supply chain risk" },
    { package: "path-to-regexp", signal: "known-vulnerability", severity: "high", description: "CVE-2024-45296: ReDoS vulnerability" },
    { package: "path-to-regexp", signal: "outdated", severity: "medium", description: "Current: 0.1.7, Latest: 8.0.0" },
    { package: "node-fetch", signal: "known-vulnerability", severity: "medium", description: "CVE-2022-0235: Information exposure" },
    { package: "node-fetch", signal: "outdated", severity: "low", description: "v2 branch, v3 available" },
    { package: "whatwg-url", signal: "outdated", severity: "low", description: "Current: 5.0.0, Latest: 14.0.0" },
    { package: "loose-envify", signal: "outdated", severity: "low", description: "No longer needed with modern bundlers" },
    { package: "jwa", signal: "outdated", severity: "low", description: "Last publish over 4 years ago" },
    { package: "jws", signal: "outdated", severity: "low", description: "Last publish over 4 years ago" },
    { package: "cookie", signal: "few-maintainers", severity: "low", description: "Only 1 maintainer" },
    { package: "path-to-regexp", signal: "few-maintainers", severity: "low", description: "Only 1 maintainer" },
  ],
  2: [
    { package: "crypto-js", signal: "known-vulnerability", severity: "critical", description: "CVE-2023-46233: PBKDF2 weakness" },
    { package: "crypto-js", signal: "unmaintained", severity: "high", description: "Archived by maintainer" },
    { package: "crypto-js", signal: "deprecated", severity: "high", description: "Maintainer recommends native crypto" },
    { package: "axios", signal: "known-vulnerability", severity: "high", description: "CVE-2023-45857: CSRF token exposure" },
    { package: "axios", signal: "outdated", severity: "medium", description: "Current: 0.21.1, Latest: 1.7.0" },
    { package: "follow-redirects", signal: "known-vulnerability", severity: "high", description: "CVE-2024-28849: Authorization header leak" },
    { package: "express", signal: "known-vulnerability", severity: "medium", description: "CVE-2024-29041: Open redirect" },
    { package: "express", signal: "outdated", severity: "medium", description: "Current: 4.17.1, Latest: 4.21.0" },
    { package: "qs", signal: "known-vulnerability", severity: "high", description: "CVE-2022-24999: Prototype pollution" },
    { package: "qs", signal: "outdated", severity: "medium", description: "Current: 6.7.0, Latest: 6.13.0" },
  ],
  3: [
    { package: "vite", signal: "info", severity: "low", description: "All dependencies up to date" },
  ],
};

// ─── API Routes ──────────────────────────────────────────────────────────────

// GET all projects
app.get("/api/projects", (_req, res) => {
  res.json(projects);
});

// GET single project
app.get("/api/projects/:id", (req, res) => {
  const project = projects.find((p) => p.id === Number(req.params.id));
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json(project);
});

// POST create/import project
app.post("/api/projects", async (req, res) => {
  const { repoUrl, branch, ecosystem } = req.body;
  if (!repoUrl) return res.status(400).json({ error: "repoUrl is required" });

  const name = repoUrl.split("/").pop().replace(".git", "") || "unknown-repo";
  const newProject = {
    id: nextProjectId++,
    name,
    repoUrl,
    branch: branch || "main",
    ecosystem: ecosystem || "npm",
    status: "pending",
    riskLevel: "unknown",
    lastScanAt: null,
    createdAt: new Date().toISOString(),
  };

  projects.push(newProject);

  // Return immediately
  res.status(201).json(newProject);

  // Run analysis in background
  console.log(`[Project ${newProject.id}] Starting analysis for ${repoUrl}...`);
  try {
    newProject.status = "running";
    const tree = await cloneAndAnalyze(repoUrl, newProject.id);

    // Update project metadata from result
    newProject.status = "success";
    newProject.lastScanAt = new Date().toISOString();
    newProject.riskLevel = tree.riskLevel || "low";

    console.log(`[Project ${newProject.id}] Analysis completed.`);
  } catch (error) {
    console.error(`[Project ${newProject.id}] Analysis failed:`, error);
    newProject.status = "failed";
  }
});

// DELETE project
app.delete("/api/projects/:id", (req, res) => {
  const idx = projects.findIndex((p) => p.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Project not found" });
  projects.splice(idx, 1);
  res.json({ ok: true });
});

// GET pipelines for a project
app.get("/api/projects/:id/pipelines", (req, res) => {
  const projectId = Number(req.params.id);
  const result = pipelines.filter((p) => p.projectId === projectId);
  res.json(result);
});

// POST trigger a new scan/pipeline
app.post("/api/projects/:id/scan", (req, res) => {
  const projectId = Number(req.params.id);
  const project = projects.find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const newPipeline = {
    id: nextPipelineId++,
    projectId,
    trigger: "manual",
    branch: project.branch,
    commit: Math.random().toString(36).substring(2, 9),
    status: "running",
    steps: [
      { name: "Clone & Install", status: "success", duration: "10s" },
      { name: "SBOM Generation", status: "success", duration: "7s" },
      { name: "Dependency Extraction", status: "running", duration: "..." },
      { name: "Graph Construction", status: "pending", duration: "-" },
      { name: "Risk Signal Analysis", status: "pending", duration: "-" },
      { name: "Score Computation", status: "pending", duration: "-" },
      { name: "Report Generation", status: "pending", duration: "-" },
    ],
    riskSummary: null,
    decision: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  pipelines.push(newPipeline);

  // Simulate pipeline completion after 3 seconds
  setTimeout(() => {
    newPipeline.status = "success";
    newPipeline.finishedAt = new Date().toISOString();
    newPipeline.steps = newPipeline.steps.map((s) => ({
      ...s,
      status: "success",
      duration: Math.floor(Math.random() * 15 + 2) + "s",
    }));
    newPipeline.riskSummary = { critical: 0, high: 1, medium: 3, low: 8 };
    newPipeline.decision = "pass";
    project.status = "success";
    project.lastScanAt = new Date().toISOString();
  }, 3000);

  res.status(201).json(newPipeline);
});

// GET dependency tree for a project
app.get("/api/projects/:id/dependencies", async (req, res) => {
  const projectId = Number(req.params.id);

  // 1. Try file
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    return res.json(await fs.readJson(dataFile));
  }

  // 2. Try mock data
  const tree = dependencyTrees[projectId];
  if (!tree) return res.status(404).json({ error: "No dependency data found. Try running a scan." });
  res.json(tree);
});

// Helper to collect all signals recursively
const collectSignals = (node, allSignals = []) => {
  if (!node) return allSignals;
  if (node.signals && node.signals.length > 0) {
    node.signals.forEach(s => {
      // Check if signal is already formatted object or just string
      if (typeof s === 'string') {
        allSignals.push({
          package: node.name,
          signal: s,
          severity: "medium", // default
          description: `Detected ${s} in ${node.name}`
        });
      } else {
        allSignals.push(s);
      }
    });
  }
  if (node.children) {
    node.children.forEach(child => collectSignals(child, allSignals));
  }
  return allSignals;
};

// GET risk signals for a project
app.get("/api/projects/:id/signals", async (req, res) => {
  const projectId = Number(req.params.id);

  // 1. Try file
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const tree = await fs.readJson(dataFile);
    const signals = collectSignals(tree);
    return res.json(signals);
  }

  // 2. Fallback to mock signals
  const signals = riskSignals[projectId] || [];
  res.json(signals);
});

// GET risk summary for a project
app.get("/api/projects/:id/risk", async (req, res) => {
  const projectId = Number(req.params.id);

  let tree;
  let signals;

  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    tree = await fs.readJson(dataFile);
    signals = collectSignals(tree);
  } else {
    tree = dependencyTrees[projectId];
    signals = riskSignals[projectId] || [];
  }

  if (!tree) return res.status(404).json({ error: "No data" });

  // Count total deps
  function countNodes(node) {
    let count = 0;
    for (const child of node.children || []) {
      count += 1 + countNodes(child);
    }
    return count;
  }

  const totalDeps = countNodes(tree);
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };

  signals.forEach((s) => {
    // If signal is string (from our new analyzer), map to severity
    let severity = "medium";
    if (typeof s === 'object' && s.severity) severity = s.severity;

    // For our generated signals, we don't have explicit severity in the string array
    // so we might need to infer it or just count it as medium

    if (severityCounts[severity] !== undefined) severityCounts[severity]++;
  });

  res.json({
    projectName: tree.name,
    overallRiskScore: tree.riskScore || 0,
    overallRiskLevel: tree.riskLevel || "unknown",
    totalDependencies: totalDeps,
    signalCounts: severityCounts,
    totalSignals: signals.length,
  });
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
  console.log(`Supply Chain CI/CD Backend running on http://localhost:${PORT}`);
});
