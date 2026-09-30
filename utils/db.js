import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// Supabase's Data API uses HTTPS, so it works in environments that cannot
// open a direct PostgreSQL connection. Keep the service role key server-side.
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

let db = null;
let auditStorageWarned = false;
let pipelineStorageWarned = false;

function toSnakeCaseObject(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), item,
  ]));
}

function toCamelCaseRow(row) {
  if (!row) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value,
  ]));
}

function requireData(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function getDb() {
  if (!db) {
    if (!supabaseUrl || !serviceRoleKey) {
      console.warn("[DB] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Database features disabled.");
      return null;
    }
    try {
      db = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      console.log("[DB] Supabase HTTPS client configured; connection will be verified on the first query.");
    } catch (err) {
      console.warn("[DB] Failed to configure Supabase:", err.message);
      return null;
    }
  }
  return db;
}

export async function dbSaveAuditEvent(event) {
  return dbSaveAuditEvents([event]);
}

export async function dbSaveAuditEvents(events) {
  if (!events.length) return true;
  const database = getDb();
  if (!database) return false;
  try {
    const rows = events.map((event) => toSnakeCaseObject({
      id: event.id,
      occurredAt: event.occurredAt,
      projectId: event.projectId ?? null,
      pipelineId: event.pipelineId ?? null,
      action: event.action,
      actor: event.actor,
      previousHash: event.previousHash,
      eventHash: event.eventHash,
      payload: event,
    }));
    for (let index = 0; index < rows.length; index += 100) {
      requireData(await database.from("audit_events").upsert(rows.slice(index, index + 100), { onConflict: "id" }));
    }
    return true;
  } catch (err) {
    if (!auditStorageWarned) {
      console.warn("[Audit] Supabase database copy unavailable; local hash-chained journal remains active.", err.message);
      auditStorageWarned = true;
    }
    return false;
  }
}

export async function dbGetAuditEvents({ projectId, limit = 200 } = {}) {
  const database = getDb();
  if (!database) return [];
  try {
    let query = database.from("audit_events").select("payload").order("occurred_at", { ascending: false }).limit(limit);
    if (projectId !== undefined) query = query.eq("project_id", projectId);
    const rows = requireData(await query) || [];
    // The database copy can restore visibility after local disk loss. Integrity
    // is unverified here unless the whole hash chain is available for checking.
    return rows.map((row) => row.payload ? { ...row.payload, integrity: "unverified" } : null).filter(Boolean);
  } catch (err) {
    if (!auditStorageWarned) {
      console.warn("[Audit] Could not load Supabase audit history; local journal remains active.", err.message);
      auditStorageWarned = true;
    }
    return [];
  }
}

// Store a complete snapshot at every pipeline transition. The JSON payload keeps
// future pipeline fields durable even before a dedicated SQL column is added.
export async function dbSavePipelineRun(pipeline) {
  const database = getDb();
  if (!database) return false;
  try {
    const row = {
      id: pipeline.id,
      projectId: pipeline.projectId,
      trigger: pipeline.trigger,
      branch: pipeline.branch || null,
      commitHash: pipeline.commit && pipeline.commit !== "pending" ? pipeline.commit : null,
      status: pipeline.status,
      steps: pipeline.steps || [],
      riskSummary: pipeline.riskSummary || null,
      decision: pipeline.decision || null,
      startedAt: pipeline.startedAt,
      finishedAt: pipeline.finishedAt || null,
      error: pipeline.error || null,
      pipelineData: pipeline,
      updatedAt: new Date().toISOString(),
    };
    requireData(await database.from("pipeline_runs").upsert(toSnakeCaseObject(row), { onConflict: "id" }));
    return true;
  } catch (err) {
    if (!pipelineStorageWarned) {
      console.warn("[Pipeline] Supabase run storage unavailable; local pipeline history remains active.", err.message);
      pipelineStorageWarned = true;
    }
    return false;
  }
}

export async function dbGetPipelineRuns() {
  const database = getDb();
  if (!database) return [];
  try {
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const page = requireData(await database.from("pipeline_runs").select("pipeline_data")
        .order("id", { ascending: true }).range(offset, offset + pageSize - 1)) || [];
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows.map((row) => row.pipeline_data).filter((run) => run && Number.isInteger(Number(run.id)));
  } catch (err) {
    if (!pipelineStorageWarned) {
      console.warn("[Pipeline] Could not load Supabase run history; local history remains active.", err.message);
      pipelineStorageWarned = true;
    }
    return null;
  }
}

// Projects
export async function dbSaveProject(project) {
  const database = getDb();
  if (!database) return null;
  try {
    const result = await database.from("projects").insert(toSnakeCaseObject({
      name: project.name,
      repoUrl: project.repoUrl,
      branch: project.branch || "main",
      ecosystem: project.ecosystem || "npm",
      status: project.status || "pending",
      riskLevel: project.riskLevel || "unknown",
    })).select().single();
    return toCamelCaseRow(requireData(result));
  } catch (err) {
    console.error("[DB] Failed to save project:", err.message);
    return null;
  }
}

export async function dbUpdateProject(id, updates) {
  const database = getDb();
  if (!database) return;
  try {
    requireData(await database.from("projects").update(toSnakeCaseObject(updates)).eq("id", id));
  } catch (err) {
    console.error("[DB] Failed to update project:", err.message);
  }
}

export async function dbGetProjects() {
  const database = getDb();
  if (!database) return [];
  try {
    return (requireData(await database.from("projects").select("*").order("created_at", { ascending: false })) || []).map(toCamelCaseRow);
  } catch (err) {
    console.error("[DB] Failed to get projects:", err.message);
    return [];
  }
}

export async function dbGetProject(id) {
  const database = getDb();
  if (!database) return null;
  try {
    const result = await database.from("projects").select("*").eq("id", id).maybeSingle();
    return toCamelCaseRow(requireData(result));
  } catch (err) {
    console.error("[DB] Failed to get project:", err.message);
    return null;
  }
}

export async function dbDeleteProject(id) {
  const database = getDb();
  if (!database) return;
  try {
    requireData(await database.from("projects").delete().eq("id", id));
  } catch (err) {
    console.error("[DB] Failed to delete project:", err.message);
  }
}

// Scans
export async function dbSaveScan(scanData, packagesData) {
  const database = getDb();
  if (!database) return null;
  try {
    const scanResult = await database.from("scans").insert(toSnakeCaseObject({
      projectId: scanData.projectId,
      pipelineId: scanData.pipelineId ?? null,
      repoUrl: scanData.repoUrl,
      commitHash: scanData.commitHash || null,
      ecosystem: scanData.ecosystem || "npm",
      overallRiskScore: scanData.overallRiskScore || 0,
      riskLevel: scanData.riskLevel || "unknown",
      totalDeps: scanData.totalDeps || 0,
      totalSignals: scanData.totalSignals || 0,
      totalAnomalies: scanData.totalAnomalies || 0,
      scanDurationMs: scanData.scanDurationMs || 0,
      mlStats: scanData.mlStats || null,
      scanData: scanData.scanData || null,
      sbom: scanData.sbom || null,
    })).select().single();
    const scan = toCamelCaseRow(requireData(scanResult));

    if (packagesData?.length) {
      const rows = packagesData.map((pkg) => toSnakeCaseObject({
        scanId: scan.id,
        name: pkg.name,
        version: pkg.version || null,
        ecosystem: pkg.ecosystem || "npm",
        riskScore: pkg.riskScore || 0,
        riskLevel: pkg.riskLevel || "low",
        anomalyScore: pkg.anomalyScore || null,
        isAnomaly: pkg.isAnomaly || false,
        depth: pkg.depth || 0,
        pagerank: pkg.pagerank || null,
        centrality: pkg.centrality || null,
        blastRadius: pkg.blastRadius || 0,
        maintainerCount: pkg.maintainerCount || null,
        ageDays: pkg.ageDays || null,
        daysSinceUpdate: pkg.daysSinceUpdate || null,
        signalsJson: pkg.signals || [],
      }));
      for (let i = 0; i < rows.length; i += 50) {
        requireData(await database.from("scan_packages").insert(rows.slice(i, i + 50)));
      }
    }
    console.log(`[DB] Saved scan #${scan.id} with ${packagesData?.length || 0} packages.`);
    return scan;
  } catch (err) {
    console.error("[DB] Failed to save scan:", err.message);
    return null;
  }
}

export async function dbGetScansForProject(projectId) {
  const database = getDb();
  if (!database) return [];
  try {
    return (requireData(await database.from("scans").select("*").eq("project_id", projectId).order("created_at", { ascending: false })) || []).map(toCamelCaseRow);
  } catch (err) {
    console.error("[DB] Failed to get scans:", err.message);
    return [];
  }
}

export async function dbGetScanPackages(scanId) {
  const database = getDb();
  if (!database) return [];
  try {
    return (requireData(await database.from("scan_packages").select("*").eq("scan_id", scanId)) || []).map(toCamelCaseRow);
  } catch (err) {
    console.error("[DB] Failed to get scan packages:", err.message);
    return [];
  }
}

export async function dbGetLatestScanForProject(projectId) {
  const database = getDb();
  if (!database) return null;
  try {
    const result = await database.from("scans").select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return toCamelCaseRow(requireData(result));
  } catch (err) {
    console.error("[DB] Failed to get latest scan:", err.message);
    return null;
  }
}

export async function dbGetGlobalStats() {
  const database = getDb();
  if (!database) return null;
  try {
    const allScans = requireData(await database.from("scans").select("total_anomalies,overall_risk_score,total_deps")) || [];
    if (allScans.length === 0) return { totalScans: 0, totalAnomalies: 0, avgRiskScore: 0, totalPackagesAnalyzed: 0 };
    return {
      totalScans: allScans.length,
      totalAnomalies: allScans.reduce((sum, scan) => sum + (scan.total_anomalies || 0), 0),
      avgRiskScore: Math.round(allScans.reduce((sum, scan) => sum + (scan.overall_risk_score || 0), 0) / allScans.length),
      totalPackagesAnalyzed: allScans.reduce((sum, scan) => sum + (scan.total_deps || 0), 0),
    };
  } catch (err) {
    console.error("[DB] Failed to get global stats:", err.message);
    return null;
  }
}
