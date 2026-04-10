import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, desc } from "drizzle-orm";
import { scans, scanPackages, projects } from "../drizzle/schema.js";

// ─── Database Connection ─────────────────────────────────────────────────────
const connectionString = process.env.DATABASE_URL;

let db = null;
let sql = null;

export function getDb() {
  if (!db) {
    if (!connectionString) {
      console.warn("[DB] No DATABASE_URL set. Database features disabled.");
      return null;
    }
    try {
      sql = postgres(connectionString, { max: 5 });
      db = drizzle(sql, { schema: { scans, scanPackages, projects } });
      console.log("[DB] Connected to Supabase PostgreSQL via Drizzle.");
    } catch (err) {
      console.warn("[DB] Failed to connect:", err.message);
      return null;
    }
  }
  return db;
}

// ─── Projects ────────────────────────────────────────────────────────────────

export async function dbSaveProject(project) {
  const database = getDb();
  if (!database) return null;
  try {
    const [row] = await database
      .insert(projects)
      .values({
        name: project.name,
        repoUrl: project.repoUrl,
        branch: project.branch || "main",
        ecosystem: project.ecosystem || "npm",
        status: project.status || "pending",
        riskLevel: project.riskLevel || "unknown",
      })
      .returning();
    return row;
  } catch (err) {
    console.error("[DB] Failed to save project:", err.message);
    return null;
  }
}

export async function dbUpdateProject(id, updates) {
  const database = getDb();
  if (!database) return;
  try {
    await database.update(projects).set(updates).where(eq(projects.id, id));
  } catch (err) {
    console.error("[DB] Failed to update project:", err.message);
  }
}

export async function dbGetProjects() {
  const database = getDb();
  if (!database) return [];
  try {
    return await database.select().from(projects).orderBy(desc(projects.createdAt));
  } catch (err) {
    console.error("[DB] Failed to get projects:", err.message);
    return [];
  }
}

export async function dbGetProject(id) {
  const database = getDb();
  if (!database) return null;
  try {
    const [row] = await database.select().from(projects).where(eq(projects.id, id));
    return row || null;
  } catch (err) {
    console.error("[DB] Failed to get project:", err.message);
    return null;
  }
}

export async function dbDeleteProject(id) {
  const database = getDb();
  if (!database) return;
  try {
    await database.delete(projects).where(eq(projects.id, id));
  } catch (err) {
    console.error("[DB] Failed to delete project:", err.message);
  }
}

// ─── Scans ───────────────────────────────────────────────────────────────────

export async function dbSaveScan(scanData, packagesData) {
  const database = getDb();
  if (!database) return null;
  try {
    const [scan] = await database
      .insert(scans)
      .values({
        projectId: scanData.projectId,
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
      })
      .returning();

    // Save individual packages
    if (packagesData && packagesData.length > 0) {
      const pkgRows = packagesData.map((pkg) => ({
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

      // Batch insert (chunks of 50)
      for (let i = 0; i < pkgRows.length; i += 50) {
        const chunk = pkgRows.slice(i, i + 50);
        await database.insert(scanPackages).values(chunk);
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
    return await database
      .select()
      .from(scans)
      .where(eq(scans.projectId, projectId))
      .orderBy(desc(scans.createdAt));
  } catch (err) {
    console.error("[DB] Failed to get scans:", err.message);
    return [];
  }
}

export async function dbGetScanPackages(scanId) {
  const database = getDb();
  if (!database) return [];
  try {
    return await database
      .select()
      .from(scanPackages)
      .where(eq(scanPackages.scanId, scanId));
  } catch (err) {
    console.error("[DB] Failed to get scan packages:", err.message);
    return [];
  }
}

export async function dbGetLatestScanForProject(projectId) {
  const database = getDb();
  if (!database) return null;
  try {
    const [row] = await database
      .select()
      .from(scans)
      .where(eq(scans.projectId, projectId))
      .orderBy(desc(scans.createdAt))
      .limit(1);
    return row || null;
  } catch (err) {
    console.error("[DB] Failed to get latest scan:", err.message);
    return null;
  }
}

export async function dbGetGlobalStats() {
  const database = getDb();
  if (!database) return null;
  try {
    const allScans = await database.select().from(scans);
    if (allScans.length === 0) return { totalScans: 0, totalAnomalies: 0, avgRiskScore: 0, totalPackagesAnalyzed: 0 };

    const totalScans = allScans.length;
    const totalAnomalies = allScans.reduce((sum, s) => sum + (s.totalAnomalies || 0), 0);
    const avgRiskScore = Math.round(allScans.reduce((sum, s) => sum + (s.overallRiskScore || 0), 0) / totalScans);
    const totalPackagesAnalyzed = allScans.reduce((sum, s) => sum + (s.totalDeps || 0), 0);

    return { totalScans, totalAnomalies, avgRiskScore, totalPackagesAnalyzed };
  } catch (err) {
    console.error("[DB] Failed to get global stats:", err.message);
    return null;
  }
}
