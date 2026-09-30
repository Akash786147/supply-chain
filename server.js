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
  dbSaveAuditEvent,
  dbGetAuditEvents,
  dbGetPipelineRuns,
  dbSavePipelineRun,
  dbSaveAuditEvents,
} from "./utils/db.js";
import {
  flattenToFeatureMatrix,
  calculateDatasetStats,
  generateRiskDistribution,
  calculateCorrelationMatrix,
  convertToCSV,
  prepareMlStats,
} from "./utils/dataset_exporter.js";
import {
  appendAuditEvent,
  getAuditEvents,
  loadPipelineRuns,
  persistPipelineRuns,
  loadLocalProjects,
  persistLocalProjects,
} from "./utils/audit_store.js";
import {
  getGitHubSession,
  getRepositoryBranches,
  getRepositoryDetails,
  hasRepositoryBranch,
  githubApi,
  parseGitHubRepoUrl,
  registerGitHubAuthRoutes,
} from "./utils/github.js";

const app = express();
app.use(express.json());
const allowedOrigins = new Set((process.env.FRONTEND_URL || "http://localhost:5173").split(",").map((origin) => origin.trim().replace(/\/$/, "")));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ""))) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  },
  credentials: true,
}));
registerGitHubAuthRoutes(app);

function sendGitHubError(res, error) {
  const status = error.status === 404 ? 404 : error.status === 401 || error.status === 403 ? error.status : 502;
  return res.status(status).json({ error: error.message || "GitHub request failed" });
}

app.get("/api/github/repos", async (req, res) => {
  const session = getGitHubSession(req);
  if (!session) return res.status(401).json({ error: "Connect your GitHub account to list repositories" });
  const page = Math.max(1, Math.min(100, Number.parseInt(req.query.page, 10) || 1));
  try {
    const { data } = await githubApi(`/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`, session.accessToken);
    res.json({
      repos: data.map((repo) => ({ id: repo.id, name: repo.name, fullName: repo.full_name, url: repo.html_url, private: repo.private, defaultBranch: repo.default_branch, description: repo.description })),
      nextPage: data.length === 100 ? page + 1 : null,
    });
  } catch (error) {
    sendGitHubError(res, error);
  }
});

app.get("/api/github/repos/:owner/:repo/branches", async (req, res) => {
  const session = getGitHubSession(req);
  if (!session) return res.status(401).json({ error: "Connect your GitHub account to list repository branches" });
  try {
    const branches = await getRepositoryBranches(`${req.params.owner}/${req.params.repo}`, session.accessToken);
    res.json(branches);
  } catch (error) {
    sendGitHubError(res, error);
  }
});

app.get("/api/github/repository", async (req, res) => {
  let parsed;
  try {
    parsed = parseGitHubRepoUrl(String(req.query.url || ""));
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const session = getGitHubSession(req);
  try {
    const token = session?.accessToken;
    const repository = await getRepositoryDetails(parsed.fullName, token);
    const branches = await getRepositoryBranches(parsed.fullName, token);
    res.json({ ...repository, branches });
  } catch (error) {
    if (error.status === 404 && !session) {
      return res.status(401).json({ error: "This repository is private or unavailable. Connect GitHub to browse it." });
    }
    return sendGitHubError(res, error);
  }
});

// ─── Initialize DB ───────────────────────────────────────────────────────────
const db = getDb();
if (db) {
  console.log("[Server] Database client configured; the first query will verify connectivity.");
} else {
  console.warn("[Server] Running without database. Set DATABASE_URL in .env to enable persistence.");
}

// ─── Local persistence fallback (for when DB is not available) ───────────────
const inMemoryProjects = await loadLocalProjects();
let nextProjectId = inMemoryProjects.reduce((id, project) => Math.max(id, project.id || 0), 0) + 1;

const localPipelines = await loadPipelineRuns();
const databasePipelineResult = db ? await dbGetPipelineRuns() : [];
const canPersistPipelineRunsToDb = Array.isArray(databasePipelineResult);
const databasePipelines = canPersistPipelineRunsToDb ? databasePipelineResult : [];
const pipelineById = new Map();
for (const pipeline of [...localPipelines, ...databasePipelines]) {
  const id = Number(pipeline.id);
  const current = pipelineById.get(id);
  const incomingUpdated = Date.parse(pipeline.updatedAt || "") || 0;
  const currentUpdated = Date.parse(current?.updatedAt || "") || 0;
  if (!current || incomingUpdated >= currentUpdated) pipelineById.set(id, pipeline);
}
const pipelines = [...pipelineById.values()].filter((pipeline) => Number.isInteger(Number(pipeline.id)))
  .sort((left, right) => Number(left.id) - Number(right.id));
// Pipeline IDs are sequential run IDs. Keep existing IDs on disk, but start a
// fresh installation at #1 (the old hard-coded 99 offset made #100 mysterious).
let nextPipelineId = pipelines.reduce((maxId, run) => Math.max(maxId, run.id || 0), 0) + 1;
const activeScans = new Set();
const eventClients = new Set();

function publishUpdate(update) {
  const message = `event: update\ndata: ${JSON.stringify(update)}\n\n`;
  for (const client of eventClients) {
    try { client.write(message); } catch { eventClients.delete(client); }
  }
}

async function persistPipelineSnapshot(pipeline) {
  pipeline.updatedAt = new Date().toISOString();
  try {
    await persistPipelineRuns(pipelines);
  } catch (error) {
    console.error(`[Pipeline] Could not save run #${pipeline.id} to local history: ${error.message}`);
  }
  // Do not write numeric run IDs into a database whose history could not be
  // read at startup; that could overwrite an existing run after a timeout.
  if (db && canPersistPipelineRunsToDb) await dbSavePipelineRun(pipeline);
}

// Backfill histories created before the durable Supabase tables were added.
// Upserts make this safe to repeat after restarts and avoid duplicate events.
if (db) {
  if (canPersistPipelineRunsToDb) {
    const databaseRunsById = new Map(databasePipelines.map((pipeline) => [Number(pipeline.id), pipeline]));
    for (const pipeline of localPipelines) {
      const databaseRun = databaseRunsById.get(Number(pipeline.id));
      const localUpdated = Date.parse(pipeline.updatedAt || "") || 0;
      const databaseUpdated = Date.parse(databaseRun?.updatedAt || "") || 0;
      if (!databaseRun || localUpdated > databaseUpdated) await dbSavePipelineRun(pipeline);
    }
  }
  const localAuditHistory = await getAuditEvents({ limit: Number.MAX_SAFE_INTEGER });
  if (localAuditHistory.length > 0) {
    await dbSaveAuditEvents(localAuditHistory.map(({ integrity, ...event }) => event));
  }
}

async function recordAuditEvent(event) {
  try {
    const saved = await appendAuditEvent(event);
    if (saved) {
      if (db) await dbSaveAuditEvent(saved);
      publishUpdate({ type: "audit", projectId: saved.projectId, event: saved });
    }
    return saved;
  } catch (error) {
    console.error("[Audit] Could not persist event:", error.message);
    return null;
  }
}

function redactRepositoryUrl(repoUrl) {
  try {
    const parsed = new URL(repoUrl);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return repoUrl;
  }
}

const interruptedPipelines = pipelines.filter((run) => run.status === "running");
for (const pipeline of interruptedPipelines) {
  pipeline.status = "failed";
  pipeline.finishedAt = new Date().toISOString();
  pipeline.steps = pipeline.steps.map((step) => ({
    ...step,
    status: step.status === "running" ? "failed" : step.status,
    error: step.status === "running" ? "Backend restarted before this step completed" : step.error,
  }));
  pipeline.error = "Backend restarted before the scan completed";
  await recordAuditEvent({
    action: "scan.interrupted",
    actor: "system",
    projectId: pipeline.projectId,
    pipelineId: pipeline.id,
    trigger: pipeline.trigger,
    error: "Backend restarted before the scan completed",
  });
  if (db) await dbUpdateProject(pipeline.projectId, { status: "failed" });
  const memoryProject = inMemoryProjects.find((project) => project.id === pipeline.projectId);
  if (memoryProject) memoryProject.status = "failed";
}
for (const pipeline of interruptedPipelines) await persistPipelineSnapshot(pipeline);
if (interruptedPipelines.length > 0 && !db) await persistLocalProjects(inMemoryProjects);

// ─── Helper ──────────────────────────────────────────────────────────────────
const collectSignals = (node, allSignals = [], rootDependency = null, depth = 0) => {
  if (!node) return allSignals;
  const currentRoot = depth === 1 ? node.name : rootDependency;
  if (node.signals && node.signals.length > 0) {
    node.signals.forEach((s) => {
      if (typeof s === "string") {
        if (s === "known-vulnerability" && node.vulnerabilities?.length) return;
        allSignals.push({
          package: node.name,
          packageVersion: node.version,
          rootDependency: currentRoot || node.name,
          signal: s,
          severity: "info",
          description: `Detected: ${s} in ${node.name}@${node.version || "?"}`,
          isAnomaly: node.isAnomaly || false,
          anomalyScore: node.anomalyScore || 0,
        });
      } else {
        allSignals.push({ ...s, isAnomaly: node.isAnomaly || false, anomalyScore: node.anomalyScore || 0 });
      }
    });
  }
  for (const vulnerability of node.vulnerabilities || []) {
    allSignals.push({
      package: node.name,
      packageVersion: node.version,
      rootDependency: currentRoot || node.name,
      signal: vulnerability.id || "known-vulnerability",
      severity: vulnerability.severity || "unknown",
      description: vulnerability.summary || "Known vulnerability reported by OSV",
      source: vulnerability.source || "OSV.dev",
      references: vulnerability.references || [],
      isAnomaly: node.isAnomaly || false,
      anomalyScore: node.anomalyScore || 0,
    });
  }
  if (depth === 0) {
    for (const finding of node.codeFindings || []) {
      allSignals.push({
        package: `${finding.file}:${finding.line}`,
        rootDependency: "Source code",
        signal: finding.ruleId,
        severity: finding.severity,
        description: finding.description,
        source: `${finding.source} · ${finding.cwe} · ${finding.confidence} confidence`,
        references: finding.references || [],
        file: finding.file,
        line: finding.line,
        snippet: finding.snippet,
      });
    }
  }
  if (node.children) {
    node.children.forEach((child) => collectSignals(child, allSignals, currentRoot, depth + 1));
  }
  return allSignals;
};

async function setProjectState(projectId, updates) {
  if (db) await dbUpdateProject(projectId, updates);
  const memoryProject = inMemoryProjects.find((project) => project.id === projectId);
  if (memoryProject) Object.assign(memoryProject, updates);
  if (!db) await persistLocalProjects(inMemoryProjects);
}

async function getLatestScanData(projectId) {
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) {
    const data = await fs.readJson(dataFile);
    const pipelineId = Number(data.scanMeta?.pipelineId);
    if (pipelineId && pipelines.some((run) => run.id === pipelineId && run.projectId === projectId && run.status === "success")) return data;
  }
  if (db) {
    const scan = await dbGetLatestScanForProject(projectId);
    if (scan?.scanData) return scan.scanData;
  }
  return null;
}

async function getLatestSbom(projectId) {
  const sbomFile = path.resolve("data", `${projectId}.sbom.json`);
  const scanData = await getLatestScanData(projectId);
  if (!scanData) return null;
  if (await fs.pathExists(sbomFile)) {
    const sbom = await fs.readJson(sbomFile);
    const sourceCommit = sbom.metadata?.properties?.find((property) => property.name === "depguard:source-commit")?.value;
    const pipelineId = sbom.metadata?.properties?.find((property) => property.name === "depguard:pipeline-id")?.value;
    if (sourceCommit === scanData.scanMeta?.commitHash && pipelineId === String(scanData.scanMeta?.pipelineId)) return sbom;
  }
  if (db) {
    const scan = await dbGetLatestScanForProject(projectId);
    if (scan?.sbom) return scan.sbom;
  }
  return null;
}

async function runProjectScan(project, trigger, githubAccessToken = null) {
  const projectId = project.id;
  if (activeScans.has(projectId)) return null;
  activeScans.add(projectId);

  const pipeline = {
    id: nextPipelineId++,
    projectId,
    repoUrl: redactRepositoryUrl(project.repoUrl),
    trigger,
    branch: project.branch || "main",
    commit: "pending",
    status: "running",
    scannerVersion: "1.1.0",
    model: "Isolation Forest (random_state=42)",
    steps: [],
    riskSummary: null,
    decision: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
  };
  pipelines.push(pipeline);
  try {
    await setProjectState(projectId, { status: "running" });
    await persistPipelineSnapshot(pipeline);
    publishUpdate({ type: "project", projectId, project: { id: projectId, status: "running" } });
  } catch (error) {
    console.error(`[Server] Could not persist initial pipeline state: ${error.message}`);
  }
  await recordAuditEvent({
    action: "scan.started",
    actor: trigger === "manual" ? "user" : "system",
    projectId,
    pipelineId: pipeline.id,
    trigger,
    repoUrl: redactRepositoryUrl(project.repoUrl),
    branch: pipeline.branch,
  });

  try {
    const parsedRepo = parseGitHubRepoUrl(project.repoUrl);
    const repository = await getRepositoryDetails(parsedRepo.fullName, githubAccessToken);
    if (!pipeline.branch || !(await hasRepositoryBranch(parsedRepo.fullName, pipeline.branch, githubAccessToken))) {
      const previousBranch = pipeline.branch;
      pipeline.branch = repository.defaultBranch;
      project.branch = pipeline.branch;
      await setProjectState(projectId, { branch: pipeline.branch });
      publishUpdate({ type: "project", projectId, project: { id: projectId, branch: pipeline.branch } });
      await recordAuditEvent({
        action: "scan.branch.defaulted",
        actor: "system",
        projectId,
        pipelineId: pipeline.id,
        previousBranch,
        branch: pipeline.branch,
      });
    }

    const result = await cloneAndAnalyze(project.repoUrl, projectId, {
      pipelineId: pipeline.id,
      branch: pipeline.branch,
      githubAccessToken,
      onStage: async (stage) => {
        const index = pipeline.steps.findIndex((step) => step.name === stage.name);
        if (index === -1) pipeline.steps.push(stage);
        else pipeline.steps[index] = stage;
        await persistPipelineSnapshot(pipeline);
        publishUpdate({ type: "pipeline", projectId, pipeline });
        await recordAuditEvent({
          action: stage.status === "running" ? "scan.stage.started" : stage.status === "failed" ? "scan.stage.failed" : "scan.stage.completed",
          actor: "system", projectId, pipelineId: pipeline.id,
          stage: stage.name, status: stage.status, duration: stage.duration,
          ...(stage.error ? { error: stage.error } : {}),
        });
      },
    });

    pipeline.commit = result.scanMeta?.commitHash || "unknown";
    pipeline.status = "success";
    pipeline.finishedAt = new Date().toISOString();

    const signalCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    collectSignals(result).forEach((signal) => {
      if (signalCounts[signal.severity] !== undefined) signalCounts[signal.severity]++;
    });
    pipeline.riskSummary = signalCounts;
    pipeline.decision = signalCounts.critical > 0 ? "block" : signalCounts.high > 2 ? "warn" : "pass";

    const projectUpdates = {
      status: "success",
      lastScanAt: new Date(),
      riskLevel: result.riskLevel || "low",
      ecosystem: result.scanMeta?.ecosystem || "npm",
    };
    await setProjectState(projectId, projectUpdates);

    if (db) {
      await dbSaveScan(
        {
          projectId,
          pipelineId: pipeline.id,
          repoUrl: project.repoUrl,
          commitHash: result.scanMeta?.commitHash || null,
          ecosystem: result.scanMeta?.ecosystem || "npm",
          overallRiskScore: result.riskScore || 0,
          riskLevel: result.riskLevel || "low",
          totalDeps: result.scanMeta?.totalDeps || 0,
          totalSignals: result.scanMeta?.totalSignals || 0,
          totalAnomalies: result.scanMeta?.totalAnomalies || 0,
          scanDurationMs: result.scanMeta?.scanDurationMs || 0,
          mlStats: result.mlStats || null,
          scanData: result,
          sbom: await fs.readJson(path.resolve("data", `${projectId}.sbom.json`)),
        },
        flattenForDb(result),
      );
    }

    await recordAuditEvent({
      action: "scan.succeeded",
      actor: "system",
      projectId,
      pipelineId: pipeline.id,
      trigger,
      scannerVersion: "1.1.0",
      model: "Isolation Forest (random_state=42)",
      repoUrl: redactRepositoryUrl(project.repoUrl),
      branch: pipeline.branch,
      commitHash: pipeline.commit,
      ecosystem: result.scanMeta?.ecosystem || "npm",
      riskLevel: result.riskLevel || "low",
      riskScore: result.riskScore || 0,
      totalDeps: result.scanMeta?.totalDeps || 0,
      totalSignals: result.scanMeta?.totalSignals || 0,
      totalAnomalies: result.scanMeta?.totalAnomalies || 0,
      scanDurationMs: result.scanMeta?.scanDurationMs || 0,
      decision: pipeline.decision,
    });
    publishUpdate({ type: "project", projectId, project: { id: projectId, ...projectUpdates } });
    console.log(`[Server] ✓ Project ${projectId} analysis completed.`);
  } catch (error) {
    pipeline.status = "failed";
    pipeline.error = String(error?.message || error || "Unknown scan failure")
      .replace(project.repoUrl, redactRepositoryUrl(project.repoUrl));
    pipeline.finishedAt = new Date().toISOString();
    try {
      await setProjectState(projectId, { status: "failed" });
    } catch (stateError) {
      console.error(`[Server] Could not persist failed project state for ${projectId}: ${stateError.message}`);
    }
    publishUpdate({ type: "project", projectId, project: { id: projectId, status: "failed" } });
    try {
      await recordAuditEvent({
        action: "scan.failed",
        actor: "system",
        projectId,
        pipelineId: pipeline.id,
        trigger,
        repoUrl: redactRepositoryUrl(project.repoUrl),
        branch: pipeline.branch,
        error: pipeline.error,
      });
    } catch (auditError) {
      console.error("[Audit] Could not record scan failure:", auditError.message);
    }
    console.error(`[Server] ✗ Project ${projectId} analysis failed:`, pipeline.error);
  } finally {
    activeScans.delete(projectId);
    await persistPipelineSnapshot(pipeline);
    publishUpdate({ type: "pipeline", projectId, pipeline });
    publishUpdate({ type: "projects" });
    publishUpdate({ type: "stats" });
  }

  return pipeline;
}

// ─── API Routes ──────────────────────────────────────────────────────────────

app.get("/api/events", (req, res) => {
  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
  eventClients.add(res);
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25000);
  req.on("close", () => { clearInterval(heartbeat); eventClients.delete(res); });
});

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
  if (typeof repoUrl !== "string" || !repoUrl.trim()) {
    return res.status(400).json({ error: "repoUrl is required" });
  }

  const session = getGitHubSession(req);
  let parsedRepo;
  let repository;
  try {
    parsedRepo = parseGitHubRepoUrl(repoUrl.trim());
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    repository = await getRepositoryDetails(parsedRepo.fullName, session?.accessToken);
  } catch (error) {
    if (error.status === 404 && !session) {
      return res.status(401).json({ error: "This repository is private or unavailable. Connect GitHub and import it from your repository list." });
    }
    return sendGitHubError(res, error);
  }

  if (repository.private && !session) {
    return res.status(401).json({ error: "Connect GitHub before importing a private repository." });
  }
  const normalizedRepoUrl = parsedRepo.cloneUrl;
  const selectedBranch = typeof branch === "string" && branch.trim() ? branch.trim() : repository.defaultBranch;
  if (!selectedBranch) return res.status(400).json({ error: "Could not determine the repository's default branch" });
  const name = repository.name || parsedRepo.repo;
  const projectData = {
    name,
    repoUrl: normalizedRepoUrl,
    branch: selectedBranch,
    ecosystem: ecosystem || "npm",
    status: "pending",
    riskLevel: "unknown",
  };

  let newProject;
  if (db) {
    newProject = await dbSaveProject(projectData);
    if (!newProject) {
      return res.status(503).json({ error: "Could not save project to the configured database" });
    }
  } else {
    newProject = { id: nextProjectId++, ...projectData, lastScanAt: null, createdAt: new Date().toISOString() };
    inMemoryProjects.push(newProject);
    await persistLocalProjects(inMemoryProjects);
  }

  await recordAuditEvent({
    action: "project.created",
    actor: "user",
    projectId: newProject.id,
    repoUrl: redactRepositoryUrl(normalizedRepoUrl),
    branch: projectData.branch,
    githubLogin: session?.user.login,
  });
  publishUpdate({ type: "project", projectId: newProject.id, project: newProject });
  res.status(201).json(newProject);
  void runProjectScan(newProject, "import", session?.accessToken).catch((error) => {
    console.error(`[Server] Could not start scan for project ${newProject.id}:`, error.message);
  });
});

// DELETE project
app.delete("/api/projects/:id", async (req, res) => {
  const projectId = Number(req.params.id);
  if (activeScans.has(projectId)) {
    return res.status(409).json({ error: "Cannot delete a project while its scan is running" });
  }
  const project = db ? await dbGetProject(projectId) : inMemoryProjects.find((p) => p.id === projectId);
  if (!project) return res.status(404).json({ error: "Project not found" });
  await recordAuditEvent({
    action: "project.deleted",
    actor: "user",
    projectId,
    repoUrl: redactRepositoryUrl(project.repoUrl),
  });
  if (db) {
    await dbDeleteProject(projectId);
  } else {
    const idx = inMemoryProjects.findIndex((p) => p.id === projectId);
    if (idx !== -1) inMemoryProjects.splice(idx, 1);
    await persistLocalProjects(inMemoryProjects);
  }
  // Also remove data file
  const dataFile = path.resolve("data", `${projectId}.json`);
  if (await fs.pathExists(dataFile)) await fs.remove(dataFile);
  const sbomFile = path.resolve("data", `${projectId}.sbom.json`);
  if (await fs.pathExists(sbomFile)) await fs.remove(sbomFile);
  res.json({ ok: true });
  publishUpdate({ type: "projects", projectId });
});

// GET pipelines for a project
app.get("/api/projects/:id/pipelines", (req, res) => {
  const projectId = Number(req.params.id);
  res.json(pipelines.filter((p) => p.projectId === projectId));
});

app.get("/api/projects/:id/sbom", async (req, res) => {
  const projectId = Number(req.params.id);
  const sbom = await getLatestSbom(projectId);
  if (!sbom) return res.status(404).json({ error: "No SBOM available. Run a scan first." });
  res.setHeader("Content-Type", "application/vnd.cyclonedx+json");
  if (req.query.download === "true") {
    res.setHeader("Content-Disposition", `attachment; filename="project-${projectId}.sbom.cdx.json"`);
  }
  res.json(sbom);
});

// Return recent local audit records. `actor` reflects the trigger source; this
// prototype does not authenticate users and therefore cannot verify identity.
app.get("/api/audit", async (req, res) => {
  const projectId = req.query.projectId === undefined ? undefined : Number(req.query.projectId);
  const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
  if ((projectId !== undefined && (!Number.isInteger(projectId) || projectId < 1)) ||
      !Number.isInteger(limit) || limit < 1) {
    return res.status(400).json({ error: "projectId and limit must be positive integers" });
  }
  const boundedLimit = Math.min(limit, 1000);
  const [localEvents, databaseEvents] = await Promise.all([
    getAuditEvents({ projectId, limit: boundedLimit }),
    db ? dbGetAuditEvents({ projectId, limit: boundedLimit }) : [],
  ]);
  const byId = new Map();
  for (const event of databaseEvents) byId.set(event.id, event);
  for (const event of localEvents) byId.set(event.id, event);
  res.json([...byId.values()].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt)).slice(0, boundedLimit));
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
  if (activeScans.has(projectId)) {
    return res.status(409).json({ error: "A scan is already running for this project" });
  }
  void runProjectScan(project, "manual", getGitHubSession(req)?.accessToken).catch((error) => {
    console.error(`[Server] Could not start scan for project ${projectId}:`, error.message);
  });
  const pipeline = pipelines.at(-1);
  res.status(201).json(pipeline);
});

// GET dependency tree for a project
app.get("/api/projects/:id/dependencies", async (req, res) => {
  const projectId = Number(req.params.id);
  const data = await getLatestScanData(projectId);
  if (data) return res.json(data);
  return res.status(404).json({ error: "No dependency data found. Try running a scan." });
});

// GET risk signals for a project
app.get("/api/projects/:id/signals", async (req, res) => {
  const projectId = Number(req.params.id);
  const tree = await getLatestScanData(projectId);
  if (!tree) return res.status(404).json({ error: "No risk findings available. Run a scan first." });
  res.json(collectSignals(tree));
});

// GET risk summary for a project
app.get("/api/projects/:id/risk", async (req, res) => {
  const projectId = Number(req.params.id);
  let tree, signals;

  tree = await getLatestScanData(projectId);
  if (tree) {
    signals = collectSignals(tree);
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

  const severityScore = { critical: 95, high: 80, medium: 60, low: 35 };
  const highestSeverity = signals.reduce((highest, signal) =>
    (severityScore[signal.severity] || 0) > (severityScore[highest] || 0) ? signal.severity : highest, "low");
  const overallRiskScore = Math.max(0, ...signals.map((signal) => severityScore[signal.severity] || 0));

  res.json({
    projectName: tree.name,
    overallRiskScore,
    overallRiskLevel: highestSeverity,
    totalDependencies: countN(tree),
    signalCounts: severityCounts,
    totalSignals: signals.filter((signal) => signal.severity !== "info").length,
    sourceFilesScanned: tree.scanMeta?.sourceFilesScanned || 0,
    sourceFindingCount: tree.scanMeta?.sourceFindingCount || 0,
    vulnerabilityScanStatus: tree.scanMeta?.vulnerabilityScanStatus || "unknown",
  });
});

// GET ML stats for a project
app.get("/api/projects/:id/ml-stats", async (req, res) => {
  const projectId = Number(req.params.id);

  // First try data file
  const data = await getLatestScanData(projectId);
  if (data?.mlStats) return res.json(data.mlStats);

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
  const databaseHistory = db ? await dbGetScansForProject(projectId) : [];
  const events = await getAuditEvents({ projectId, limit: 1000 });
  const eventHistory = events
    .filter((event) => event.action === "scan.succeeded")
    .map((event) => ({
      id: event.pipelineId,
      pipelineId: event.pipelineId,
      projectId,
      repoUrl: event.repoUrl,
      commitHash: event.commitHash || null,
      ecosystem: event.ecosystem || "npm",
      overallRiskScore: event.riskScore || 0,
      riskLevel: event.riskLevel || "unknown",
      totalDeps: event.totalDeps || 0,
      totalSignals: event.totalSignals || 0,
      totalAnomalies: event.totalAnomalies || 0,
      scanDurationMs: event.scanDurationMs || 0,
      mlStats: null,
      createdAt: event.occurredAt,
    }));
  const isAlreadyStored = (event) => databaseHistory.some((scan) =>
    (scan.pipelineId && Number(scan.pipelineId) === Number(event.id)) ||
    (scan.commitHash && scan.commitHash === event.commitHash &&
      Math.abs(new Date(scan.createdAt).getTime() - new Date(event.createdAt).getTime()) < 60000)
  );
  const scanHistory = [...databaseHistory, ...eventHistory.filter((event) => !isAlreadyStored(event))]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(scanHistory);
});

// GET global stats
app.get("/api/stats/global", async (_req, res) => {
  const completed = (await getAuditEvents({ limit: 1000 })).filter((event) => event.action === "scan.succeeded");
  if (completed.length) {
    return res.json({
      totalScans: completed.length,
      totalAnomalies: completed.reduce((sum, event) => sum + (event.totalAnomalies || 0), 0),
      avgRiskScore: Math.round(completed.reduce((sum, event) => sum + (event.riskScore || 0), 0) / completed.length),
      totalPackagesAnalyzed: completed.reduce((sum, event) => sum + (event.totalDeps || 0), 0),
    });
  }
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
  const tree = await getLatestScanData(projectId);
  if (tree) {
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

  res.status(404).json({ error: "No dataset available" });
});

// GET dataset stats for a project
app.get("/api/projects/:id/dataset/stats", async (req, res) => {
  const projectId = Number(req.params.id);
  const tree = await getLatestScanData(projectId);
  if (tree) {
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
  const tree = await getLatestScanData(projectId);
  if (tree) {
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

  let featureMatrix;
  const tree = await getLatestScanData(projectId);
  if (tree) {
    featureMatrix = flattenToFeatureMatrix(tree);
  } else {
    return res.status(404).json({ error: "No dataset available" });
  }

  if (format === "csv") {
    const csv = convertToCSV(featureMatrix);
    const filename = `dataset_${projectId}_${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await recordAuditEvent({ action: "dataset.exported", actor: "user", projectId, format, rows: featureMatrix.length });
    res.send(csv);
  } else if (format === "json") {
    const filename = `dataset_${projectId}_${new Date().toISOString().split("T")[0]}.json`;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await recordAuditEvent({ action: "dataset.exported", actor: "user", projectId, format, rows: featureMatrix.length });
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

const PORT = Number.parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, () => {
  console.log(`\n🛡️  Supply Chain CI/CD Backend running on http://localhost:${PORT}`);
  console.log(`   Database: ${db ? "Client configured; awaiting first-query verification" : "Not configured (using local persistence)"}\n`);
});
