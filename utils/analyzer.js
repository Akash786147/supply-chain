import fs from "fs-extra";
import path from "path";
import simpleGit from "simple-git";
import { exec } from "child_process";
import { promisify } from "util";
import { spawn } from "child_process";

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
    const res = await fetch(url);
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

// ─── Batch fetch with concurrency ────────────────────────────────────────────
async function batchFetchMetadata(packageNames) {
  const results = {};
  const BATCH_SIZE = 5;
  const unique = [...new Set(packageNames)];

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (name) => {
      const meta = await fetchNpmMetadata(name);
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
    return { signals, riskScore: 15 };
  }

  let score = 0;

  // Known deprecation
  if (meta.isDeprecated) {
    signals.push("deprecated");
    score += 20;
  }

  // Unmaintained (no update in > 730 days = 2 years)
  if (meta.daysSinceUpdate && meta.daysSinceUpdate > 730) {
    signals.push("unmaintained");
    score += 15;
  }

  // Outdated (no update in > 365 days)
  if (meta.daysSinceUpdate && meta.daysSinceUpdate > 365 && !signals.includes("unmaintained")) {
    signals.push("outdated");
    score += 8;
  }

  // Few maintainers
  if (meta.maintainerCount <= 1) {
    signals.push("few-maintainers");
    score += 10;
  }

  // No repository
  if (!meta.hasRepo) {
    signals.push("no-repository");
    score += 12;
  }

  // No license
  if (!meta.license) {
    signals.push("no-license");
    score += 5;
  }

  // Very new package (< 30 days old)
  if (meta.ageDays !== null && meta.ageDays < 30) {
    signals.push("very-new");
    score += 18;
  }

  // Version mismatch check (installed vs latest)
  if (meta.latestVersion && node.version) {
    const installedMajor = parseInt(node.version.split(".")[0]) || 0;
    const latestMajor = parseInt(meta.latestVersion.split(".")[0]) || 0;
    if (latestMajor - installedMajor >= 3) {
      signals.push("major-version-lag");
      score += 10;
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
  node.riskLevel =
    riskScore > 60 ? "critical" : riskScore > 40 ? "high" : riskScore > 20 ? "medium" : "low";
  node.maintainerCount = meta.maintainerCount ?? 1;
  node.ageDays = meta.ageDays ?? 365;
  node.daysSinceUpdate = meta.daysSinceUpdate ?? 30;
  node.depth = depth;

  // Recurse
  for (const child of node.children || []) {
    enrichTree(child, metadata, depth + 1);
  }

  // Propagate risk upward (parent inherits portion of children's risk)
  if (node.children && node.children.length > 0) {
    const maxChildRisk = Math.max(...node.children.map((c) => c.riskScore || 0));
    const propagated = Math.floor(maxChildRisk * 0.3);
    node.riskScore = Math.min(100, node.riskScore + propagated);
    node.riskLevel =
      node.riskScore > 60 ? "critical" : node.riskScore > 40 ? "high" : node.riskScore > 20 ? "medium" : "low";
  }

  return node;
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
    const proc = spawn("python3", [mlScript]);

    let stdout = "";
    let stderr = "";

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
        resolve(result);
      } catch (err) {
        console.error("[ML] Failed to parse output:", stdout.substring(0, 200));
        reject(new Error("ML engine returned invalid JSON"));
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });

    // Send input
    proc.stdin.write(JSON.stringify({ tree }));
    proc.stdin.end();
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

// ─── Main Analysis Pipeline ─────────────────────────────────────────────────
export async function cloneAndAnalyze(repoUrl, projectId) {
  const containerDir = path.resolve("container");
  const projectDir = path.join(containerDir, String(projectId));
  const dataDir = path.resolve("data");
  const outputFile = path.join(dataDir, `${projectId}.json`);

  await fs.ensureDir(containerDir);
  await fs.ensureDir(dataDir);

  // Clean previous run if exists
  if (await fs.pathExists(projectDir)) {
    console.log(`[Analyzer] Cleaning up previous build for project ${projectId}...`);
    await fs.remove(projectDir);
  }

  const startTime = Date.now();

  try {
    // Step 1: Clone
    console.log(`[Analyzer] Step 1/6: Cloning ${repoUrl}...`);
    await simpleGit().clone(repoUrl, projectDir, ["--depth", "1"]);

    // Step 2: Detect ecosystem
    const ecosystem = await detectEcosystem(projectDir);
    console.log(`[Analyzer] Step 2/6: Detected ecosystem: ${ecosystem}`);

    let dependencyTree;

    if (ecosystem === "npm") {
      // Step 3: Install dependencies
      console.log(`[Analyzer] Step 3/6: Installing npm dependencies...`);
      try {
        await execAsync("npm install --ignore-scripts --no-audit --no-fund", {
          cwd: projectDir,
          timeout: 120000,
        });
      } catch (installErr) {
        console.warn(`[Analyzer] npm install had warnings: ${installErr.message?.substring(0, 100)}`);
      }

      // Step 4: Extract dependency tree
      console.log(`[Analyzer] Step 4/6: Extracting dependency tree...`);
      let stdout;
      try {
        const result = await execAsync("npm list --all --json 2>/dev/null", {
          cwd: projectDir,
          maxBuffer: 1024 * 1024 * 10,
        });
        stdout = result.stdout;
      } catch (listErr) {
        // npm list often exits with code 1 for missing peer deps but still outputs valid JSON
        stdout = listErr.stdout || "{}";
      }

      const rawTree = JSON.parse(stdout);
      dependencyTree = transformNpmTree(rawTree, rawTree.name || "root");
    } else {
      // Python: basic requirements.txt parsing
      console.log(`[Analyzer] Step 3/6: Parsing Python dependencies...`);
      dependencyTree = await parsePythonDeps(projectDir);
    }

    // Step 5: Fetch real metadata & compute risk signals
    console.log(`[Analyzer] Step 5/6: Fetching registry metadata & computing risk signals...`);
    const packageNames = collectPackageNames(dependencyTree);
    console.log(`[Analyzer]   Found ${packageNames.size} unique packages. Fetching metadata...`);
    const metadata = await batchFetchMetadata([...packageNames]);
    enrichTree(dependencyTree, metadata);

    // Step 6: Run ML anomaly detection
    console.log(`[Analyzer] Step 6/6: Running ML anomaly detection...`);
    let mlResult;
    try {
      mlResult = await runMLEngine(dependencyTree);
      dependencyTree = mlResult.tree;
    } catch (mlErr) {
      console.warn(`[Analyzer] ML engine failed, continuing without ML: ${mlErr.message}`);
      mlResult = { mlStats: null, edges: [] };
    }

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
        scanDurationMs,
        totalDeps,
        totalSignals,
        totalAnomalies: mlResult?.mlStats?.totalAnomalies || 0,
        scannedAt: new Date().toISOString(),
      },
    };

    await fs.writeJson(outputFile, output, { spaces: 2 });
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
    version: "1.0.0",
    riskScore: 0,
    riskLevel: "low",
    signals: [],
    children,
  };
}

// Export helper for server to use
export { flattenForDb, countNodes, countSignals };
