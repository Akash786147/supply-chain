import fs from "fs-extra";
import path from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";

const DATA_DIR = path.resolve("data");
const AUDIT_FILE = path.join(DATA_DIR, "audit_events.jsonl");
const PIPELINES_FILE = path.join(DATA_DIR, "pipelines.json");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
let pipelineWriteQueue = Promise.resolve();
let auditWriteQueue = Promise.resolve();
let projectWriteQueue = Promise.resolve();

function hashEntry(entry) {
  const { eventHash, ...payload } = entry;
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function appendAuditEvent(event) {
  let saved;
  auditWriteQueue = auditWriteQueue.catch(() => {}).then(async () => {
    await fs.ensureDir(DATA_DIR);
    const events = await readRawAuditEvents();
    const previousHash = events.at(-1)?.eventHash || "GENESIS";
    const entry = {
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      actor: event.actor || "system",
      ...event,
      previousHash,
    };
    entry.eventHash = hashEntry(entry);
    await fs.appendFile(AUDIT_FILE, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
    await fs.chmod(AUDIT_FILE, 0o600);
    saved = entry;
  });
  await auditWriteQueue;
  return saved;
}

async function readRawAuditEvents() {
  if (!(await fs.pathExists(AUDIT_FILE))) return [];
  const content = await fs.readFile(AUDIT_FILE, "utf8");
  return content.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

export async function getAuditEvents({ projectId, limit = 200 } = {}) {
  const events = await readRawAuditEvents();
  let previousHash = "GENESIS";
  for (const event of events) {
    if (!event.previousHash || !event.eventHash) {
      event.integrity = "unverified";
      continue;
    }
    const valid = event.previousHash === previousHash && event.eventHash === hashEntry(event);
    event.integrity = valid ? "valid" : "invalid";
    previousHash = event.eventHash || "INVALID";
  }
  const filtered = projectId === undefined
    ? events
    : events.filter((event) => Number(event.projectId) === Number(projectId));
  return filtered.slice(-limit).reverse();
}

export async function loadPipelineRuns() {
  try {
    const runs = await fs.readJson(PIPELINES_FILE);
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

export async function loadLocalProjects() {
  try {
    const projects = await fs.readJson(PROJECTS_FILE);
    return Array.isArray(projects) ? projects : [];
  } catch { return []; }
}

export function persistLocalProjects(projects) {
  const snapshot = JSON.stringify(projects, null, 2);
  projectWriteQueue = projectWriteQueue.catch(() => {}).then(async () => {
    await fs.ensureDir(DATA_DIR);
    const temporaryFile = `${PROJECTS_FILE}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, snapshot, "utf8");
    await fs.move(temporaryFile, PROJECTS_FILE, { overwrite: true });
  });
  return projectWriteQueue;
}

export function persistPipelineRuns(runs) {
  const snapshot = JSON.stringify(runs, null, 2);
  pipelineWriteQueue = pipelineWriteQueue.catch(() => {}).then(async () => {
    await fs.ensureDir(DATA_DIR);
    const temporaryFile = `${PIPELINES_FILE}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryFile, snapshot, "utf8");
    await fs.move(temporaryFile, PIPELINES_FILE, { overwrite: true });
  });
  return pipelineWriteQueue;
}
