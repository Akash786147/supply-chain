import { randomBytes } from "node:crypto";

const GITHUB_API = "https://api.github.com";
const SESSION_COOKIE = "depguard_github_session";
const STATE_COOKIE = "depguard_github_oauth_state";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const sessions = new Map();
const oauthStates = new Map();

export function isGitHubOAuthConfigured() {
  return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET && process.env.GITHUB_CALLBACK_URL);
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try { return decodeURIComponent(part.slice(separator + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

function sessionCookie(value, maxAge) {
  const production = process.env.NODE_ENV === "production";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=${production ? "None" : "Lax"}; Max-Age=${maxAge}${production ? "; Secure" : ""}`;
}

export function getGitHubSession(req) {
  const id = readCookie(req, SESSION_COOKIE);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export async function githubApi(path, token) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "DepGuard-Supply-Chain-Analyzer",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `GitHub API request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return { data: payload, headers: response.headers };
}

export function parseGitHubRepoUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error("Enter a valid GitHub repository URL"); }
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password) {
    throw new Error("Only HTTPS GitHub repository URLs are supported");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 2) throw new Error("Use a repository URL like https://github.com/owner/repository");
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error("The repository URL contains an unsupported owner or repository name");
  }
  return { owner, repo, fullName: `${owner}/${repo}`, cloneUrl: `https://github.com/${owner}/${repo}.git` };
}

export async function getRepositoryDetails(fullName, token) {
  const parts = fullName.split("/");
  if (parts.length !== 2) throw new Error("Invalid repository name");
  const [owner, repo] = parts;
  const { data } = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);
  return {
    id: data.id,
    name: data.name,
    fullName: data.full_name,
    url: data.html_url,
    private: data.private,
    defaultBranch: data.default_branch,
  };
}

export async function getRepositoryBranches(fullName, token) {
  const parts = fullName.split("/");
  if (parts.length !== 2) throw new Error("Invalid repository name");
  const [owner, repo] = parts;
  const { data } = await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`, token);
  return data.map((branch) => ({ name: branch.name, protected: branch.protected }));
}

export async function hasRepositoryBranch(fullName, branchName, token) {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo || !branchName) return false;
  const encodedBranch = branchName.split("/").map(encodeURIComponent).join("/");
  try {
    await githubApi(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodedBranch}`, token);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

export function registerGitHubAuthRoutes(app) {
  app.get("/api/auth/github/status", (req, res) => {
    const session = getGitHubSession(req);
    res.json({ configured: isGitHubOAuthConfigured(), authenticated: Boolean(session), user: session?.user || null });
  });

  app.get("/api/auth/github/start", (req, res) => {
    if (!isGitHubOAuthConfigured()) {
      return res.status(503).send("GitHub OAuth is not configured. Set GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and GITHUB_CALLBACK_URL in backend/.env.");
    }
    const state = randomBytes(32).toString("hex");
    oauthStates.set(state, Date.now() + OAUTH_STATE_TTL_MS);
    const production = process.env.NODE_ENV === "production";
    res.setHeader("Set-Cookie", `${STATE_COOKIE}=${state}; Path=/; HttpOnly; SameSite=${production ? "None" : "Lax"}; Max-Age=${OAUTH_STATE_TTL_MS / 1000}${production ? "; Secure" : ""}`);
    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", process.env.GITHUB_CALLBACK_URL);
    authorizeUrl.searchParams.set("scope", "read:user repo");
    authorizeUrl.searchParams.set("state", state);
    res.redirect(authorizeUrl.toString());
  });

  app.get("/api/auth/github/callback", async (req, res) => {
    const { code, state, error: oauthError } = req.query;
    const production = process.env.NODE_ENV === "production";
    const clearStateCookie = `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=${production ? "None" : "Lax"}; Max-Age=0${production ? "; Secure" : ""}`;
    if (oauthError) {
      res.setHeader("Set-Cookie", clearStateCookie);
      return res.redirect(`${frontendUrl()}/?github_auth=denied`);
    }
    const expiresAt = typeof state === "string" ? oauthStates.get(state) : null;
    if (!expiresAt || expiresAt <= Date.now() || readCookie(req, STATE_COOKIE) !== state) {
      res.setHeader("Set-Cookie", clearStateCookie);
      return res.redirect(`${frontendUrl()}/?github_auth=invalid_state`);
    }
    oauthStates.delete(state);
    if (typeof code !== "string" || !isGitHubOAuthConfigured()) {
      res.setHeader("Set-Cookie", clearStateCookie);
      return res.redirect(`${frontendUrl()}/?github_auth=failed`);
    }

    try {
      const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "DepGuard-Supply-Chain-Analyzer" },
        body: JSON.stringify({ client_id: process.env.GITHUB_CLIENT_ID, client_secret: process.env.GITHUB_CLIENT_SECRET, code }),
        signal: AbortSignal.timeout(20000),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || tokenData.error || !tokenData.access_token) {
        res.setHeader("Set-Cookie", clearStateCookie);
        return res.redirect(`${frontendUrl()}/?github_auth=failed`);
      }
      const { data: user } = await githubApi("/user", tokenData.access_token);
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, {
        accessToken: tokenData.access_token,
        user: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url },
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      res.setHeader("Set-Cookie", [sessionCookie(sessionId, SESSION_TTL_MS / 1000), clearStateCookie]);
      return res.redirect(`${frontendUrl()}/?github_auth=connected`);
    } catch (error) {
      console.error("[GitHub OAuth] Callback failed:", error.message);
      res.setHeader("Set-Cookie", clearStateCookie);
      return res.redirect(`${frontendUrl()}/?github_auth=failed`);
    }
  });

  app.post("/api/auth/github/logout", (req, res) => {
    const sessionId = readCookie(req, SESSION_COOKIE);
    if (sessionId) sessions.delete(sessionId);
    res.setHeader("Set-Cookie", sessionCookie("", 0));
    res.json({ ok: true });
  });
}
