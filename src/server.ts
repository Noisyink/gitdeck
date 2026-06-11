import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { CLIENT_INDEX_PATH, HOST, PORT, SOURCE_INDEX_PATH } from "./server/config";
import {
  getIssuesCached,
  getPullRequestsCached,
  getReposCached,
} from "./server/dashboardData";
import { handleDailyDigests } from "./server/digests";
import { getAuthMode } from "./server/authProvider";
import { send, sendJsonCacheable, sendStaticFile } from "./server/http";
import { handleRepoInsights } from "./server/repoInsights";
import { getCIHealthCached } from "./server/ciHealth";

import { handleAuthStatus, handleAuthStart, handleAuthPoll, handleAuthLogout } from "./server/handlers/auth";
import {
  handleAccountsList,
  handleAccountActivate,
  handleProviderConfigsList,
  handleAccountAddToken,
  handleAccountRemove,
} from "./server/handlers/accounts";
import { handleStargazers, handleForks, handleRepoDetails } from "./server/handlers/repos";
import {
  handleMentionIssues,
  handleMentionCode,
  handleRepoAliases,
  handleReferrers,
  handleDependents,
} from "./server/handlers/mentions";
import { handleProjects, handleProject, handleProjectMove } from "./server/handlers/projects";
import { handleThread } from "./server/handlers/thread";
import { handleSummary } from "./server/handlers/summary";
import { handleCreateComment } from "./server/handlers/comment";
import { handleSettings } from "./server/handlers/settings";

/* ===================== ROUTING ===================== */

// Slice-6: cached-route dispatch table. The route prefixes must be ordered
// most-specific first so /api/ci-health does not shadow a hypothetical longer
// prefix. Each entry: [urlPrefix, (fresh: boolean) => Promise<{ok:boolean;...}>]
type CachedFetcher = (fresh: boolean) => Promise<{ ok: boolean }>;
const CACHED_ROUTES: [string, CachedFetcher][] = [
  ["/api/ci-health", getCIHealthCached],
  ["/api/repos", getReposCached],
  ["/api/issues", getIssuesCached],
  ["/api/prs", getPullRequestsCached],
];

const APP_ROUTES = new Set([
  "/",
  "/index.html",
  "/repositories",
  "/issues",
  "/pull-requests",
  "/insights",
  "/alerts",
  "/ci",
  "/daily",
  "/board",
  "/alert",
]);

async function sendClientIndex(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(CLIENT_INDEX_PATH, "utf-8").catch(() => readFile(SOURCE_INDEX_PATH, "utf-8"));
    send(res, 200, html, "text/html; charset=utf-8");
  } catch {
    send(res, 500, "index.html not found", "text/plain; charset=utf-8");
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const pathname = new URL(url, "http://localhost").pathname;
  if (APP_ROUTES.has(pathname)) return sendClientIndex(res);
  if (await sendStaticFile(res, pathname)) return;
  if (url.startsWith("/api/auth/status")) return handleAuthStatus(res);
  if (url.startsWith("/api/auth/start")) return handleAuthStart(req, res);
  if (url.startsWith("/api/auth/poll")) return handleAuthPoll(req, res);
  if (url.startsWith("/api/auth/logout")) return handleAuthLogout(req, res);
  if (url.startsWith("/api/accounts/activate")) return handleAccountActivate(req, res);
  if (url.startsWith("/api/accounts/add-token")) return handleAccountAddToken(req, res);
  if (url.startsWith("/api/provider-configs")) return handleProviderConfigsList(res);
  if (url.startsWith("/api/accounts")) {
    if (req.method === "DELETE") {
      return handleAccountRemove(req, res, new URL(url, "http://localhost"));
    }
    return handleAccountsList(res);
  }
  if (url.startsWith("/api/stargazers")) {
    return handleStargazers(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/forks")) {
    return handleForks(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/issues")) {
    return handleMentionIssues(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/code")) {
    return handleMentionCode(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-aliases")) {
    return handleRepoAliases(req, res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/referrers")) {
    return handleReferrers(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/mentions/dependents")) {
    return handleDependents(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-details")) {
    return handleRepoDetails(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/repo-insights")) {
    return handleRepoInsights(req, res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/daily-digests")) {
    return handleDailyDigests(req, res);
  }
  // Slice-6: table-driven cached data routes — all share the same 7-line
  // shape (parse fresh, call fetcher, derive status, sendJsonCacheable).
  for (const [prefix, fetcher] of CACHED_ROUTES) {
    if (url.startsWith(prefix)) {
      const fresh = new URL(url, "http://localhost").searchParams.get("fresh") === "1";
      const payload = await fetcher(fresh);
      const status = payload.ok ? 200 : (payload as { needsAuth?: boolean }).needsAuth ? 401 : 500;
      sendJsonCacheable(req, res, status, payload);
      return;
    }
  }
  if (url.startsWith("/api/projects")) {
    return handleProjects(res);
  }
  if (url.startsWith("/api/project/move")) {
    return handleProjectMove(req, res);
  }
  if (url.startsWith("/api/project")) {
    return handleProject(res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/comment")) {
    return handleCreateComment(req, res);
  }
  if (url.startsWith("/api/thread")) {
    return handleThread(req, res, new URL(url, "http://localhost"));
  }
  if (url.startsWith("/api/settings")) {
    return handleSettings(req, res);
  }
  if (url.startsWith("/api/summary")) {
    return handleSummary(req, res);
  }
  const lastSlash = pathname.lastIndexOf("/");
  const fileName = lastSlash >= 0 ? pathname.slice(lastSlash + 1) : pathname;
  if (!fileName.includes(".")) {
    return sendClientIndex(res);
  }
  send(res, 404, "not found", "text/plain; charset=utf-8");
}

export { handle };

if (!process.env.VITEST) {
  createServer((req, res) => {
    handle(req, res).catch((err) => {
      send(res, 500, String(err), "text/plain; charset=utf-8");
    });
  }).listen(PORT, HOST, () => {
    console.log(`GitHub Issues Dashboard -> http://${HOST}:${PORT}`);
    console.log(`Auth mode: ${getAuthMode()}`);
  });
}
