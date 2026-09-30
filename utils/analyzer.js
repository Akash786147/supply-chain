import fs from "fs-extra";
import path from "path";
import os from "node:os";
import { existsSync } from "node:fs";
import simpleGit from "simple-git";
import { exec } from "child_process";
import { promisify } from "util";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { scanSourceCode } from "./source_scan.js";

const execAsync = promisify(exec);

// ─── Metadata Cache ─────────────────────────────────────────────────────────
const CACHE_DIR = path.resolve("data", "cache");
await fs.ensureDir(CACHE_DIR);

async function getCachedMetadata(pkg) {
  const cacheFile = path.join(CACHE_DIR, `${pkg.replace(/\//g, "__")}.json`);
  if (await fs.pathExists(cacheFile)) {
    const stat = await fs.stat(cacheFile);
    const ageHours = (Date.now() - stat.mtimeMs) / (1000 * 60 * 60);
    if (ageHours < 24) {
      return fs.readJson(cacheFile);
    }
  }
  return null;
}

async function setCachedMetadata(pkg, data) {
  const cacheFile = path.join(CACHE_DIR, `${pkg.replace(/\//g, "__")}.json`);
  await fs.writeJson(cacheFile, data);
}

// ─── NPM Registry Fetch ─────────────────────────────────────────────────────
async function fetchNpmMetadata(packageName) {
  const cached = await getCachedMetadata(packageName);
  if (cached) return cached;

  try {
    const url = `https://registry.npmjs.org/${encodeURIComponent(packageName)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const data = await res.json();

    const latestVersion = data["dist-tags"]?.latest || "0.0.0";
    const times = data.time || {};
    const createdAt = times.created ? new Date(times.created) : null;
    const lastPublish = times[latestVersion] ? new Date(times[latestVersion]) : null;
    const now = new Date();

    const maintainers = data.maintainers || [];
    const isDeprecated = !!data.versions?.[latestVersion]?.deprecated;
    const hasRepo = !!data.repository;
    const license = data.license || data.versions?.[latestVersion]?.license || null;

    const metadata = {
      name: packageName,
      latestVersion,
      maintainerCount: maintainers.length,
      ageDays: createdAt ? Math.floor((now - createdAt) / (1000 * 60 * 60 * 24)) : null,
      daysSinceUpdate: lastPublish ? Math.floor((now - lastPublish) / (1000 * 60 * 60 * 24)) : null,
      isDeprecated,
      hasRepo,
      license,
      totalVersions: Object.keys(data.versions || {}).length,
    };

    await setCachedMetadata(packageName, metadata);
    return metadata;
  } catch (err) {
    console.warn(`[Registry] Failed to fetch ${packageName}: ${err.message}`);
    return null;
  }
}

async function fetchPyPIMetadata(packageName) {
  const cacheKey = `pypi:${packageName}`;
  const cached = await getCachedMetadata(cacheKey);
  if (cached) return cached;
  try {
    const response = await fetch(`https://pypi.org/pypi/${encodeURIComponent(packageName)}/json`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const data = await response.json();
    const releases = Object.values(data.releases || {}).flat();
    const uploadTimes = releases.map((release) => release.upload_time_iso_8601 || release.upload_time)
      .filter(Boolean).map((value) => new Date(value)).filter((value) => Number.isFinite(value.getTime())).sort((a, b) => a - b);
    const info = data.info || {};
    const projectUrls = Object.values(info.project_urls || {}).join(" ");
    const metadata = {
      name: info.name || packageName,
      latestVersion: info.version || "0.0.0",
      maintainerCount: null,
      ageDays: uploadTimes.length ? Math.floor((Date.now() - uploadTimes[0].getTime()) / 86400000) : null,
      daysSinceUpdate: uploadTimes.length ? Math.floor((Date.now() - uploadTimes.at(-1).getTime()) / 86400000) : null,
      isDeprecated: false,
      hasRepo: /github|gitlab|bitbucket|source/i.test(projectUrls),
      license: info.license || null,
      totalVersions: Object.keys(data.releases || {}).length,
    };
    await setCachedMetadata(cacheKey, metadata);
    return metadata;
  } catch (error) {
    console.warn(`[PyPI] Failed to fetch ${packageName}: ${error.message}`);
    return null;
  }
}

// ─── Batch fetch with concurrency ────────────────────────────────────────────
async function batchFetchMetadata(packageNames, ecosystem = "npm") {
  const results = {};
  const BATCH_SIZE = 5;
  const unique = [...new Set(packageNames)];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (name) => {
      const meta = ecosystem === "pypi" ? await fetchPyPIMetadata(name) : await fetchNpmMetadata(name);
      results[name] = meta;
    });
    await Promise.all(promises);

    // Small delay to avoid rate limiting
    if (i + BATCH_SIZE < unique.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return results;
}

// ─── Collect all package names from tree ─────────────────────────────────────
function collectPackageNames(node, names = new Set()) {
  if (node.name) names.add(node.name);
  for (const child of node.children || []) {
    collectPackageNames(child, names);
  }
  return names;
}

// ─── Compute Risk Signals ────────────────────────────────────────────────────
function computeRiskSignals(node, metadata) {
  const signals = [];
  const meta = metadata[node.name];

  if (!meta) {
    // No metadata found — flag it
    if (node.name && !node.name.startsWith("@types/")) {
      signals.push("no-metadata");
    }
    return { signals, riskScore: 0 };
  }

  let score = 0;

  // Registry metadata describes maintenance context. These signals are kept
  // visible, but intentionally contribute little or no security risk by themselves.
  if (meta.isDeprecated) {
    signals.push("deprecated");
    score += 5;
  }

  // Unmaintained (no update in > 730 days = 2 years)
  if (meta.daysSinceUpdate && meta.daysSinceUpdate > 730) {
    signals.push("unmaintained");
    score += 3;
  }

  // Outdated (no update in > 365 days)
  if (meta.daysSinceUpdate && meta.daysSinceUpdate > 365 && !signals.includes("unmaintained")) {
    signals.push("outdated");
    score += 1;
  }

  // Few maintainers
  if (meta.maintainerCount !== null && meta.maintainerCount !== undefined && meta.maintainerCount <= 1) {
    signals.push("few-maintainers");
    score += 0;
  }

  // No repository
  if (!meta.hasRepo) {
    signals.push("no-repository");
    score += 0;
  }

  // No license
  if (!meta.license) {
    signals.push("no-license");
    score += 0;
  }

  // Very new package (< 30 days old)
  if (meta.ageDays !== null && meta.ageDays < 30) {
    signals.push("very-new");
    score += 0;
  }

  // Version mismatch check (installed vs latest)
  if (meta.latestVersion && node.version) {
    const installedMajor = parseInt(node.version.split(".")[0]) || 0;
    const latestMajor = parseInt(meta.latestVersion.split(".")[0]) || 0;
    if (latestMajor - installedMajor >= 3) {
      signals.push("major-version-lag");
      score += 0;
    }
  }

  return { signals, riskScore: Math.min(score, 100) };
}

// ─── Enrich tree with metadata ───────────────────────────────────────────────
function enrichTree(node, metadata, depth = 0) {
  const { signals, riskScore } = computeRiskSignals(node, metadata);
  const meta = metadata[node.name] || {};

  node.signals = signals;
  node.riskScore = riskScore;
  node.baseRiskScore = riskScore;
  node.riskLevel = riskLevelForScore(riskScore);
  node.maintainerCount = meta.maintainerCount ?? null;
  node.ageDays = meta.ageDays ?? null;
  node.daysSinceUpdate = meta.daysSinceUpdate ?? null;
  node.license = meta.license ?? null;
  node.depth = depth;

  // Recurse
  for (const child of node.children || []) {
    enrichTree(child, metadata, depth + 1);
  }

  return node;
}

function riskLevelForScore(score) {
  if (score >= 90) return "critical";
  if (score >= 70) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function severityRiskScore(severity) {
  return { critical: 95, high: 80, medium: 60, low: 35, unknown: 20 }[severity] || 20;
}

function recomputePropagatedRisk(node) {
  for (const child of node.children || []) recomputePropagatedRisk(child);
  const advisoryScore = Math.max(0, ...(node.vulnerabilities || []).map((vuln) => severityRiskScore(vuln.severity)));
  node.riskScore = Math.max(node.baseRiskScore || 0, advisoryScore);
  node.riskLevel = riskLevelForScore(node.riskScore);
}

// ─── Count tree nodes ────────────────────────────────────────────────────────
function countNodes(node) {
  let count = 1;
  for (const child of node.children || []) {
    count += countNodes(child);
  }
  return count;
}

function countSignals(node) {
  let count = (node.signals || []).length;
  for (const child of node.children || []) {
    count += countSignals(child);
  }
  return count;
}

// ─── Flatten tree for DB storage ─────────────────────────────────────────────
function flattenForDb(node, list = []) {
  list.push({
    name: node.name,
    version: node.version,
    riskScore: node.riskScore || 0,
    riskLevel: node.riskLevel || "low",
    anomalyScore: node.anomalyScore || 0,
    isAnomaly: node.isAnomaly || false,
    depth: node.depth || 0,
    pagerank: node.pagerank || 0,
    centrality: node.centrality || 0,
    blastRadius: node.blastRadius || 0,
    maintainerCount: node.maintainerCount || null,
    ageDays: node.ageDays || null,
    daysSinceUpdate: node.daysSinceUpdate || null,
    signals: node.signals || [],
  });
  for (const child of node.children || []) {
    flattenForDb(child, list);
  }
  return list;
}

// ─── Run Python ML Engine ────────────────────────────────────────────────────
function runMLEngine(tree) {
  return new Promise((resolve, reject) => {
    const mlScript = path.resolve("utils", "ml_engine.py");
    const localPython = path.resolve(".venv", "bin", "python");
    const pythonExecutable = process.env.ML_PYTHON || (existsSync(localPython) ? localPython : "python3");
    const proc = spawn(pythonExecutable, [mlScript]);

    let stdout = "";
    let stderr = "";
    let stdinError = null;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (stderr) console.warn("[ML] stderr:", stderr.substring(0, 200));
      try {
        const result = JSON.parse(stdout);
        if (code !== 0) {
          const detail = stderr.trim().slice(0, 500);
          return rejectOnce(new Error(`ML engine exited with code ${code}${detail ? `: ${detail}` : ""}`));
        }
        if (stdinError) return rejectOnce(new Error(`Could not send scan data to ML engine: ${stdinError.message}`));
        if (result.error) return rejectOnce(new Error(`ML engine failed: ${result.error}`));
        settled = true;
        resolve(result);
      } catch (err) {
        console.error("[ML] Failed to parse output:", stdout.substring(0, 200));
        const detail = stderr.trim().slice(0, 500);
        rejectOnce(new Error(`ML engine returned invalid JSON${detail ? `: ${detail}` : ""}`));
      }
    });

    proc.on("error", (err) => {
      rejectOnce(err);
    });

    // Python may fail during startup (for example, if its ML dependencies are
    // missing) before consuming stdin. Handle EPIPE so it becomes an ordinary
    // ML-stage failure instead of an unhandled Node stream error.
    proc.stdin.on("error", (err) => { stdinError = err; });
    proc.stdin.end(JSON.stringify({ tree }));
  });
}

// ─── Detect ecosystem ────────────────────────────────────────────────────────
async function detectEcosystem(projectDir) {
  if (await fs.pathExists(path.join(projectDir, "package.json"))) return "npm";
  if (await fs.pathExists(path.join(projectDir, "requirements.txt"))) return "pypi";
  if (await fs.pathExists(path.join(projectDir, "Pipfile.lock"))) return "pypi";
  if (await fs.pathExists(path.join(projectDir, "pyproject.toml"))) return "pypi";
  return "npm";
}

function collectTreeNodes(root) {
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.children || []) walk(child);
  };
  for (const child of root.children || []) walk(child);
  return nodes;
}

function osvEcosystem(ecosystem) { return ecosystem === "npm" ? "npm" : "PyPI"; }

function vulnerabilitySeverity(vulnerability) {
  const databaseSeverity = vulnerability.database_specific?.severity;
  const raw = (typeof databaseSeverity === "object" ? databaseSeverity?.severity : databaseSeverity) || vulnerability.severity?.[0]?.score || "";
  const match = String(raw).match(/^([0-9]+(?:\.[0-9]+)?)/);
  const score = match ? Number(match[1]) : 0;
  if (/critical/i.test(raw) || score >= 9) return "critical";
  if (/high/i.test(raw) || score >= 7) return "high";
  if (/medium|moderate/i.test(raw) || score >= 4) return "medium";
  return raw ? "low" : "unknown";
}

async function queryOsv(nodes, ecosystem) {
  const candidates = nodes.filter((node) => node.depth > 0 && node.name && node.version && node.version !== "latest" && node.version !== "0.0.0");
  const findings = [];
  for (let offset = 0; offset < candidates.length; offset += 100) {
    const batch = candidates.slice(offset, offset + 100);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch("https://api.osv.dev/v1/querybatch", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: batch.map((node) => ({
          package: { name: node.name, ecosystem: osvEcosystem(ecosystem) }, version: node.version,
        })) }),
      });
      if (!response.ok) throw new Error(`OSV returned ${response.status}`);
      const payload = await response.json();
      const idLists = batch.map((_, index) => (payload.results?.[index]?.vulns || []).map(({ id }) => id).filter(Boolean).slice(0, 20));
      const advisoryIds = [...new Set(idLists.flat())];
      const advisories = new Map();
      for (let i = 0; i < advisoryIds.length; i += 8) {
        await Promise.all(advisoryIds.slice(i, i + 8).map(async (id) => {
          try {
            const advisory = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`, { signal: controller.signal });
            advisories.set(id, advisory.ok ? await advisory.json() : { id });
          } catch { advisories.set(id, { id }); }
        }));
      }
      for (let index = 0; index < batch.length; index++) {
        const vulnerabilities = idLists[index].map((id) => advisories.get(id) || { id }).map((vuln) => ({
          id: vuln.id,
          summary: vuln.summary || "Known vulnerability reported by OSV",
          severity: vulnerabilitySeverity(vuln),
          aliases: vuln.aliases || [],
          modified: vuln.modified || null,
          references: (vuln.references || []).slice(0, 5).map((ref) => ref.url),
          source: "OSV.dev",
        }));
        if (vulnerabilities.length) {
          batch[index].vulnerabilities = vulnerabilities;
          for (const vuln of vulnerabilities) {
            batch[index].signals = [...new Set([...(batch[index].signals || []), "known-vulnerability"] )];
          }
          const advisoryScore = Math.max(...vulnerabilities.map((vuln) => severityRiskScore(vuln.severity)));
          batch[index].riskScore = Math.max(batch[index].baseRiskScore || 0, advisoryScore);
          batch[index].riskLevel = riskLevelForScore(batch[index].riskScore);
          findings.push(...vulnerabilities.map((vulnerability) => ({
            ...vulnerability, package: batch[index].name, version: batch[index].version,
          })));
        }
      }
    } finally { clearTimeout(timeout); }
  }
  return { findings, queriedPackages: candidates.length, status: "complete" };
}

function createCycloneDx(root, ecosystem, commitHash, pipelineId, findings) {
  const nodes = collectTreeNodes(root);
  const purlType = ecosystem === "npm" ? "npm" : "pypi";
  const componentMap = new Map(nodes.filter((node) => node !== root).map((node) => {
    const purl = `pkg:${purlType}/${encodeURIComponent(node.name).replaceAll("%2F", "/")}@${node.version}`;
    return [purl, {
    "bom-ref": `pkg:${purlType}/${encodeURIComponent(node.name).replaceAll("%2F", "/")}@${node.version}`,
    type: "library", name: node.name, version: node.version,
    purl,
    licenses: node.license ? [{ license: { name: node.license } }] : undefined,
    properties: [{ name: "depguard:risk-score", value: String(node.riskScore || 0) }],
  }];
  }));
  const ref = (name, version) => `pkg:${purlType}/${encodeURIComponent(name).replaceAll("%2F", "/")}@${version}`;
  const vulnerabilities = findings.map((finding) => ({
    id: finding.id, source: { name: finding.source, url: "https://osv.dev" },
    ratings: [{ severity: finding.severity }], description: finding.summary,
    affects: [{ ref: ref(finding.package, finding.version) }],
    references: finding.references.map((url) => ({ id: url, source: { name: "OSV" } })),
  }));
  const dependencyMap = new Map();
  const addDependencies = (node) => {
    const componentRef = ref(node.name, node.version);
    const dependsOn = [...new Set([
      ...(dependencyMap.get(componentRef)?.dependsOn || []),
      ...(node.children || []).map((child) => ref(child.name, child.version)),
    ])];
    dependencyMap.set(componentRef, { ref: componentRef, dependsOn });
    for (const child of node.children || []) addDependencies(child);
  };
  addDependencies(root);
  return {
    bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1, metadata: { timestamp: new Date().toISOString(), tools: [{ vendor: "DepGuard", name: "Dependency Risk Analyzer", version: "1.1.0" }], component: { type: "application", name: root.name, version: root.version, purl: `pkg:${purlType}/${encodeURIComponent(root.name)}@${root.version}` }, properties: [{ name: "depguard:source-commit", value: commitHash }, { name: "depguard:pipeline-id", value: String(pipelineId) }] },
    components: [...componentMap.values()], dependencies: [...dependencyMap.values()], vulnerabilities,
  };
}

// ─── Main Analysis Pipeline ─────────────────────────────────────────────────
export async function cloneAndAnalyze(repoUrl, projectId, { onStage, pipelineId, branch, githubAccessToken } = {}) {
  const containerDir = path.resolve("container");
  const projectDir = path.join(containerDir, String(projectId));
  const dataDir = path.resolve("data");
  const outputFile = path.join(dataDir, `${projectId}.json`);
  const sbomFile = path.join(dataDir, `${projectId}.sbom.json`);

  await fs.ensureDir(containerDir);
  await fs.ensureDir(dataDir);

  // Clean previous run if exists
  if (await fs.pathExists(projectDir)) {
    console.log(`[Analyzer] Cleaning up previous build for project ${projectId}...`);
    await fs.remove(projectDir);
  }

  const startTime = Date.now();

  const notifyStage = async (update) => {
    try {
      await onStage?.(update);
    } catch (error) {
      console.warn(`[Analyzer] Could not record stage update: ${error.message}`);
    }
  };

  const runStage = async (name, operation) => {
    const startedAt = Date.now();
    try {
      await notifyStage({ name, status: "running", duration: "..." });
      const result = await operation();
      await notifyStage({
        name,
        status: "success",
        duration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      });
      return result;
    } catch (error) {
      await notifyStage({
        name,
        status: "failed",
        duration: `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
        error: String(error?.message || error || "Unknown step failure"),
      });
      throw error;
    }
  };

  try {
    // Step 1: Clone
    console.log(`[Analyzer] Step 1/5: Cloning ${repoUrl}...`);
    const commitHash = await runStage("Clone Repository", async () => {
      let git = simpleGit();
      let askPassFile;
      try {
        if (githubAccessToken) {
          askPassFile = path.join(os.tmpdir(), `depguard-git-askpass-${randomUUID()}`);
          await fs.writeFile(askPassFile, [
            "#!/bin/sh",
            'case "$1" in',
            "  *Username*) printf '%s\\n' 'x-access-token' ;;",
            "  *Password*) printf '%s\\n' \"$DEPGUARD_GITHUB_TOKEN\" ;;",
            "*) exit 1 ;;",
            "esac",
            "",
          ].join("\n"), { mode: 0o700, flag: "wx" });
          git = git
            .env("GIT_ASKPASS", askPassFile)
            .env("DEPGUARD_GITHUB_TOKEN", githubAccessToken)
            .env("GIT_TERMINAL_PROMPT", "0");
        }
        const cloneOptions = [
          ...(githubAccessToken ? ["-c", "credential.helper="] : []),
          "--depth", "1",
          ...(branch ? [`--branch=${branch}`] : []),
        ];
        await git.clone(repoUrl, projectDir, cloneOptions);
      } finally {
        if (askPassFile) await fs.remove(askPassFile).catch(() => {});
      }
      return (await simpleGit(projectDir).revparse(["HEAD"])).trim();
    });

    // Step 2: Detect ecosystem
    const ecosystem = await runStage("Detect Ecosystem", () => detectEcosystem(projectDir));
    console.log(`[Analyzer] Step 2/5: Detected ecosystem: ${ecosystem}`);

    let dependencyTree;

    if (ecosystem === "npm") {
      console.log(`[Analyzer] Step 2/5: Installing and extracting npm dependencies...`);
      dependencyTree = await runStage("Install and Extract Dependencies", async () => {
        try {
          await execAsync("npm install --ignore-scripts --no-audit --no-fund", {
            cwd: projectDir,
            timeout: 120000,
          });
        } catch (installErr) {
          console.warn(`[Analyzer] npm install had warnings: ${installErr.message?.substring(0, 100)}`);
        }

        let stdout;
        try {
          const result = await execAsync("npm list --all --json 2>/dev/null", {
            cwd: projectDir,
            maxBuffer: 1024 * 1024 * 10,
          });
          stdout = result.stdout;
        } catch (listErr) {
          // npm list can exit nonzero for peer dependency issues while returning usable JSON.
          stdout = listErr.stdout || "{}";
        }

        const rawTree = JSON.parse(stdout);
        return transformNpmTree(rawTree, rawTree.name || "root");
      });
    } else {
      console.log(`[Analyzer] Step 2/5: Parsing Python dependencies...`);
      dependencyTree = await runStage("Extract Dependencies", () => parsePythonDeps(projectDir));
    }

    // Step 5: Fetch real metadata & compute risk signals
    console.log(`[Analyzer] Step 3/5: Fetching registry metadata & computing risk signals...`);
    await runStage("Enrich Risk Metadata", async () => {
      const packageNames = collectPackageNames(dependencyTree);
      console.log(`[Analyzer]   Found ${packageNames.size} unique packages. Fetching metadata...`);
      const metadata = await batchFetchMetadata([...packageNames], ecosystem);
      enrichTree(dependencyTree, metadata);
    });

    let codeScanResult = { findings: [], filesScanned: 0, status: "complete" };
    codeScanResult = await runStage("Source Code Security Scan", () => scanSourceCode(projectDir));

    let vulnerabilityResult = { findings: [], queriedPackages: 0, status: "unavailable" };
    try {
      vulnerabilityResult = await runStage("SBOM and Vulnerability Analysis", async () => {
        const nodes = collectTreeNodes(dependencyTree);
        const result = await queryOsv(nodes, ecosystem);
        recomputePropagatedRisk(dependencyTree);
        return result;
      });
    } catch (error) {
      console.warn(`[OSV] Advisory lookup unavailable: ${error.message}`);
      vulnerabilityResult = { findings: [], queriedPackages: 0, status: "unavailable", error: error.message };
    }

    // Step 6: Run ML anomaly detection
    console.log(`[Analyzer] Step 4/5: Running ML anomaly detection...`);
    let mlResult;
    try {
      mlResult = await runStage("ML Outlier Analysis", async () => {
        const result = await runMLEngine(dependencyTree);
        dependencyTree = result.tree;
        return result;
      });
    } catch (mlErr) {
      console.warn(`[Analyzer] ML engine failed, continuing without ML: ${mlErr.message}`);
      mlResult = { mlStats: null, edges: [] };
    }

    const severityScores = { critical: 95, high: 80, medium: 60, low: 35 };
    const highestPackageScore = Math.max(0, ...collectTreeNodes(dependencyTree).map((node) => node.riskScore || 0));
    const highestSourceScore = Math.max(0, ...codeScanResult.findings.map((finding) => severityScores[finding.severity] || 0));
    dependencyTree.riskScore = Math.max(highestPackageScore, highestSourceScore);
    dependencyTree.riskLevel = riskLevelForScore(dependencyTree.riskScore);

    const scanDurationMs = Date.now() - startTime;
    const totalDeps = countNodes(dependencyTree) - 1; // exclude root
    const totalSignals = countSignals(dependencyTree);

    // Build full output
    const output = {
      ...dependencyTree,
      mlStats: mlResult?.mlStats || null,
      edges: mlResult?.edges || [],
      scanMeta: {
        ecosystem,
        pipelineId,
        commitHash,
        scanDurationMs,
        totalDeps,
        totalSignals,
        totalAnomalies: mlResult?.mlStats?.totalAnomalies || 0,
        vulnerabilityCount: vulnerabilityResult.findings.length,
        vulnerabilityScanStatus: vulnerabilityResult.status,
        vulnerabilityPackagesQueried: vulnerabilityResult.queriedPackages,
        sourceFilesScanned: codeScanResult.filesScanned,
        sourceFindingCount: codeScanResult.findings.length,
        scannedAt: new Date().toISOString(),
      },
      codeFindings: codeScanResult.findings,
    };

    const sbom = createCycloneDx(dependencyTree, ecosystem, commitHash, pipelineId, vulnerabilityResult.findings);
    output.sbomMeta = { format: "CycloneDX", specVersion: "1.6", components: sbom.components.length, vulnerabilities: sbom.vulnerabilities.length };
    await runStage("Generate SBOM", () => fs.writeJson(sbomFile, sbom, { spaces: 2 }));
    await runStage("Save Scan Results", () => fs.writeJson(outputFile, output, { spaces: 2 }));
    console.log(`[Analyzer] ✓ Analysis complete in ${(scanDurationMs / 1000).toFixed(1)}s. ${totalDeps} deps, ${totalSignals} signals. Saved to ${outputFile}`);

    return output;
  } catch (error) {
    console.error(`[Analyzer] Analysis failed for project ${projectId}:`, error.message);
    throw error;
  }
}

// ─── Transform npm list JSON to our tree format ──────────────────────────────
function transformNpmTree(node, key) {
  const children = [];
  if (node.dependencies) {
    Object.entries(node.dependencies).forEach(([depName, depData]) => {
      children.push(transformNpmTree(depData, depName));
    });
  }

  return {
    id: key || node.name || "unknown",
    name: key || node.name || "unknown",
    version: node.version || "0.0.0",
    riskScore: 0,
    riskLevel: "low",
    signals: [],
    children,
  };
}

// ─── Parse Python requirements.txt ───────────────────────────────────────────
async function parsePythonDeps(projectDir) {
  const reqFile = path.join(projectDir, "requirements.txt");
  const children = [];

  if (await fs.pathExists(reqFile)) {
    const content = await fs.readFile(reqFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("-"));

    for (const line of lines) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*([><=!~]+\s*[\d.]+)?/);
      if (match) {
        children.push({
          id: match[1],
          name: match[1],
          version: match[2] ? match[2].replace(/[><=!~\s]/g, "") : "latest",
          riskScore: 0,
          riskLevel: "low",
          signals: [],
          children: [],
        });
      }
    }
  }

  const pkgName = path.basename(projectDir);
  return {
    id: pkgName,
    name: pkgName,
    version: "1.1.0",
    riskScore: 0,
    riskLevel: "low",
    signals: [],
    children,
  };
}

// Export helper for server to use
export { flattenForDb, countNodes, countSignals };
