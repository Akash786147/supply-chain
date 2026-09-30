import fs from "fs-extra";
import path from "path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".vue", ".svelte", ".html", ".py", ".java", ".go", ".php", ".rb"]);
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "vendor", "dist", "build", "coverage", ".next", ".venv", "venv"]);
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const RULES = [
  {
    id: "JS-EVAL", cwe: "CWE-95", title: "Dynamic code execution", severity: "medium", confidence: "medium",
    description: "Dynamic evaluation can execute attacker-controlled input. Check that the evaluated value cannot be influenced by untrusted data.",
    match: (line) => /\beval\s*\(|\bnew\s+Function\s*\(/.test(line),
  },
  {
    id: "CMD-SHELL-INPUT", cwe: "CWE-78", title: "Shell command built from input", severity: "medium", confidence: "medium",
    description: "A shell command appears to include interpolated or concatenated input. Prefer argument arrays and avoid shell interpretation.",
    match: (line, ext) => ext === ".py"
      ? /subprocess\.(?:run|Popen|call|check_output)\s*\(.*shell\s*=\s*True/.test(line)
      : /\bexec(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|[^,)]*\+\s*[^,)]*)/.test(line),
  },
  {
    id: "TLS-VERIFY-OFF", cwe: "CWE-295", title: "TLS certificate verification disabled", severity: "high", confidence: "high",
    description: "TLS certificate verification appears to be disabled, which can allow man-in-the-middle attacks.",
    match: (line) => /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']0["']|verify\s*=\s*False/.test(line),
  },
  {
    id: "HTML-UNTRUSTED", cwe: "CWE-79", title: "Potential unsafe HTML injection", severity: "medium", confidence: "medium",
    description: "HTML is assigned or rendered directly. Confirm the value is sanitized before it can contain user-controlled content.",
    match: (line) => /\.innerHTML\s*=|dangerouslySetInnerHTML\s*=|\bv-html\s*=/.test(line),
  },
  {
    id: "PY-UNSAFE-LOAD", cwe: "CWE-502", title: "Potential unsafe deserialization", severity: "medium", confidence: "medium",
    description: "Deserialization of untrusted data can execute code or construct unsafe objects. Prefer safe parsers and trusted inputs.",
    match: (line, ext) => ext === ".py" && (/\bpickle\.loads?\s*\(|\byaml\.load\s*\((?!.*Loader\s*=\s*yaml\.SafeLoader)/.test(line)),
  },
  {
    id: "SQL-INPUT-CONCAT", cwe: "CWE-89", title: "Potential SQL built with interpolation", severity: "medium", confidence: "low",
    description: "A SQL statement appears to include interpolated or concatenated values. Use parameterized queries and verify the values cannot alter the statement.",
    match: (line) => /\b(?:query|execute)\s*\(\s*(?:f["']|[`"'])[^\n]*(?:\$\{|\{[^}]+\}|["']\s*\+)/i.test(line)
      && /\b(?:select|insert|update|delete)\b/i.test(line),
  },
  {
    id: "HARDCODED-CREDENTIAL", cwe: "CWE-798", title: "Possible hard-coded credential", severity: "medium", confidence: "low",
    description: "A credential-like variable appears to contain a literal value. Verify it is not a real secret and move secrets to a secret store.",
    match: (line) => /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'][^"']{8,}["']/.test(line)
      && !/process\.env|os\.environ|getenv\s*\(|example|dummy|placeholder|changeme|your[_ -]/i.test(line),
  },
];

function safeSnippet(line) {
  return line.trim()
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\b\s*[:=]\s*["'])[^"']+(["'])/ig, "$1[REDACTED]$2")
    .slice(0, 220);
}

async function collectSourceFiles(root) {
  const files = [];
  const pending = [root];
  while (pending.length && files.length < MAX_FILES) {
    const directory = pending.pop();
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(fullPath);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
        if (files.length >= MAX_FILES) break;
      }
    }
  }
  return files;
}

export async function scanSourceCode(projectDir) {
  const findings = [];
  const files = await collectSourceFiles(projectDir);
  let filesScanned = 0;
  let bytesScanned = 0;
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.size > MAX_FILE_BYTES || bytesScanned + stat.size > MAX_TOTAL_BYTES) continue;
      const content = await fs.readFile(file, "utf8");
      filesScanned += 1;
      bytesScanned += stat.size;
      const lines = content.split(/\r?\n/);
      const extension = path.extname(file).toLowerCase();
      lines.forEach((line, index) => {
        if (!line.trim() || /^\s*(?:\/\/|#|\*|<!--)/.test(line)) return;
        for (const rule of RULES) {
          if (!rule.match(line, extension)) continue;
          findings.push({
            id: `${rule.id}:${path.relative(projectDir, file)}:${index + 1}`,
            ruleId: rule.id,
            cwe: rule.cwe,
            title: rule.title,
            severity: rule.severity,
            confidence: rule.confidence,
            description: rule.description,
            file: path.relative(projectDir, file),
            line: index + 1,
            snippet: safeSnippet(line),
            source: "Static source-code rule",
            references: [`https://cwe.mitre.org/data/definitions/${rule.cwe.replace("CWE-", "")}.html`],
          });
        }
      });
    } catch { /* Skip unreadable or non-text source files without failing the scan. */ }
  }
  return { findings, filesScanned, status: "complete" };
}
