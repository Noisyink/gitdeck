/**
 * Route-level characterization tests for server.ts.
 *
 * These tests import the exported `handle` function and drive it directly with
 * mock IncomingMessage / ServerResponse objects (no bound port), with the
 * upstream modules mocked so no filesystem or network access occurs.
 *
 * Coverage (per brief):
 *   /api/repos, /api/issues, /api/prs   — cached-route shape + needsAuth
 *   /api/thread                          — ok shape + 400s for missing/invalid
 *   /api/summary                         — cached hit / fresh / needsKey
 *   /api/settings                        — GET hides raw key; PUT updates
 *   /api/comment                         — success + validation 400s
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Module-level mocks — must appear before any import of the tested module.
// ---------------------------------------------------------------------------

// Mocks for dashboardData cached fetchers
vi.mock("../../src/server/dashboardData", () => ({
  getReposCached: vi.fn(),
  getIssuesCached: vi.fn(),
  getPullRequestsCached: vi.fn(),
  invalidateDataCache: vi.fn(),
}));

// Mock for ciHealth
vi.mock("../../src/server/ciHealth", () => ({
  getCIHealthCached: vi.fn(),
  invalidateCIHealthCache: vi.fn(),
}));

// Mock for accountStore — provides getActive + init + others needed by server.ts
vi.mock("../../src/server/accountStore", () => ({
  getActive: vi.fn(),
  init: vi.fn().mockResolvedValue(undefined),
  add: vi.fn(),
  list: vi.fn().mockResolvedValue([]),
  remove: vi.fn(),
  setActive: vi.fn(),
  getProviderConfig: vi.fn(),
  listProviderConfigs: vi.fn().mockResolvedValue({}),
  listAccountsStore: vi.fn().mockResolvedValue([]),
}));

// Mock for registry
vi.mock("../../src/server/providers/registry", () => ({
  getProvider: vi.fn(),
  getProviderForAccount: vi.fn(),
  resetProviderCache: vi.fn(),
}));

// Mock for settingsStore
vi.mock("../../src/server/settingsStore", () => ({
  getPublicSettings: vi.fn(),
  updateSettings: vi.fn(),
  isSummaryModel: vi.fn().mockReturnValue(false),
  getSettings: vi.fn(),
  getContribFilter: vi.fn().mockResolvedValue("author:@me"),
}));

// Mock for summaryCache
vi.mock("../../src/server/summaryCache", () => ({
  getCachedSummary: vi.fn(),
  setCachedSummary: vi.fn().mockResolvedValue(undefined),
}));

// Mock for anthropicSummary
vi.mock("../../src/server/anthropicSummary", () => ({
  summariseThread: vi.fn(),
}));

// Mock for digests — server.ts imports handleDailyDigests
vi.mock("../../src/server/digests", () => ({
  getLatestRepoDigest: vi.fn().mockResolvedValue(null),
  handleDailyDigests: vi.fn().mockImplementation((_req, res) => {
    const r = res as ServerResponse;
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end(JSON.stringify({ ok: true }));
  }),
}));

// Mock for repoInsights
vi.mock("../../src/server/repoInsights", () => ({
  handleRepoInsights: vi.fn().mockImplementation((_req, res) => {
    const r = res as ServerResponse;
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end(JSON.stringify({ ok: true }));
  }),
}));

// Mock for http module's sendStaticFile — always returns false (no files to serve)
vi.mock("../../src/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/http")>();
  return {
    ...actual,
    sendStaticFile: vi.fn().mockResolvedValue(false),
  };
});

// Mock for oauth
vi.mock("../../src/server/oauth", () => ({
  authStatus: vi.fn().mockResolvedValue({ authenticated: false }),
  isClientIdConfigured: vi.fn().mockReturnValue(false),
  logout: vi.fn().mockResolvedValue(undefined),
  pollDeviceFlow: vi.fn(),
  startDeviceFlow: vi.fn(),
}));

// Mock for authProvider
vi.mock("../../src/server/authProvider", () => ({
  getAuthMode: vi.fn().mockReturnValue("device"),
  getActiveToken: vi.fn().mockRejectedValue(new Error("not authenticated")),
}));

// Mock for aliasStore
vi.mock("../../src/server/aliasStore", () => ({
  getAliases: vi.fn().mockResolvedValue([]),
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
}));

// Mock for securityAlerts
vi.mock("../../src/server/securityAlerts", () => ({
  fetchRepoSecuritySummary: vi.fn().mockResolvedValue({ ok: true, alerts: [] }),
}));

// Mock githubClient to avoid real HTTP
vi.mock("../../src/server/githubClient", () => ({
  AuthRequiredError: class AuthRequiredError extends Error {
    constructor(msg = "authentication required") { super(msg); this.name = "AuthRequiredError"; }
  },
  getToken: vi.fn().mockRejectedValue(new Error("not authenticated")),
  gql: vi.fn(),
  restApi: vi.fn(),
  restApiPaginate: vi.fn(),
  ghApiJson: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import the handle function AFTER all mocks are set up
// ---------------------------------------------------------------------------

import { handle } from "../../src/server";
import * as dashboardData from "../../src/server/dashboardData";
import * as registry from "../../src/server/providers/registry";
import * as settingsStore from "../../src/server/settingsStore";
import * as summaryCache from "../../src/server/summaryCache";
import * as anthropicSummary from "../../src/server/anthropicSummary";
import * as accountStore from "../../src/server/accountStore";
import * as ciHealth from "../../src/server/ciHealth";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Build minimal mock IncomingMessage / ServerResponse objects and call handle.
 * Returns a promise resolving to the captured response.
 */
function makeRequest(
  method: string,
  url: string,
  body?: unknown,
): Promise<MockResponse> {
  const chunks: Buffer[] = [];
  if (body !== undefined) {
    chunks.push(Buffer.from(JSON.stringify(body)));
  }

  let chunkIndex = 0;
  const req = {
    method,
    url,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    // Async iterator for body reading
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (chunkIndex < chunks.length) {
            return Promise.resolve({ value: chunks[chunkIndex++], done: false });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  } as unknown as IncomingMessage;

  return new Promise<MockResponse>((resolve) => {
    const captured: MockResponse = { statusCode: 0, headers: {}, body: "" };
    const bodyParts: Buffer[] = [];

    const res = {
      writeHead(status: number, headers?: Record<string, string | number>) {
        captured.statusCode = status;
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            captured.headers[k.toLowerCase()] = String(v);
          }
        }
      },
      end(data?: Buffer | string) {
        if (data) bodyParts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        captured.body = Buffer.concat(bodyParts).toString("utf-8");
        resolve(captured);
      },
    } as unknown as ServerResponse;

    handle(req, res).catch((err) => {
      captured.statusCode = 500;
      captured.body = String(err);
      resolve(captured);
    });
  });
}

function parseBody(res: MockResponse): unknown {
  try {
    return JSON.parse(res.body);
  } catch {
    return res.body;
  }
}

// A fake account for mocks that need one
const FAKE_ACCOUNT = {
  id: "gh_test",
  providerKind: "github" as const,
  providerConfigId: "github.com",
  label: "test",
  login: "testuser",
  accessToken: "tok",
  scope: "repo",
  obtainedAt: "2026-01-01T00:00:00Z",
  source: "device" as const,
};

// A stub provider for provider mocks
function makeStubProvider(overrides: Partial<{
  listRepos: () => Promise<unknown[]>;
  listIssues: () => Promise<unknown[]>;
  listPullRequests: () => Promise<unknown[]>;
  fetchThread: (account: unknown, repo: string, number: number) => Promise<unknown>;
  createComment: (account: unknown, repo: string, number: number, body: string) => Promise<unknown>;
}> = {}) {
  return {
    kind: "github" as const,
    capabilities: {},
    listOwners: vi.fn().mockResolvedValue({ ok: true, owners: ["testuser"] }),
    listRepos: overrides.listRepos ?? vi.fn().mockResolvedValue([]),
    listIssues: overrides.listIssues ?? vi.fn().mockResolvedValue([]),
    listPullRequests: overrides.listPullRequests ?? vi.fn().mockResolvedValue([]),
    fetchThread: overrides.fetchThread ?? vi.fn().mockResolvedValue({ ok: true, item: {}, entries: [], truncated: false }),
    createComment: overrides.createComment ?? vi.fn().mockResolvedValue({ ok: true, htmlUrl: "https://github.com/a/b/issues/1#issuecomment-1" }),
  };
}

// ---------------------------------------------------------------------------
// /api/repos, /api/issues, /api/prs — cached route branches
// ---------------------------------------------------------------------------

describe("GET /api/repos", () => {
  const cachedOkResult = {
    ok: true as const,
    repos: [{ nameWithOwner: "owner/repo", name: "repo" }] as never,
    owners: ["owner"],
    fetchedAt: "2026-01-01T00:00:00Z",
  };

  beforeEach(() => {
    vi.mocked(dashboardData.getReposCached).mockResolvedValue(cachedOkResult);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns 200 with the cached repos payload", async () => {
    const res = await makeRequest("GET", "/api/repos");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; repos: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.repos)).toBe(true);
  });

  it("passes fresh=false when no query param", async () => {
    await makeRequest("GET", "/api/repos");
    expect(dashboardData.getReposCached).toHaveBeenCalledWith(false);
  });

  it("passes fresh=true when ?fresh=1", async () => {
    await makeRequest("GET", "/api/repos?fresh=1");
    expect(dashboardData.getReposCached).toHaveBeenCalledWith(true);
  });

  it("returns 401 when payload has needsAuth", async () => {
    vi.mocked(dashboardData.getReposCached).mockResolvedValue({
      ok: false,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("GET", "/api/repos");
    expect(res.statusCode).toBe(401);
    const body = parseBody(res) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns 500 on non-auth error", async () => {
    vi.mocked(dashboardData.getReposCached).mockResolvedValue({
      ok: false,
      error: "something broke",
    });
    const res = await makeRequest("GET", "/api/repos");
    expect(res.statusCode).toBe(500);
  });
});

describe("GET /api/issues", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 200 with ok shape", async () => {
    vi.mocked(dashboardData.getIssuesCached).mockResolvedValue({
      ok: true,
      issues: [],
      owners: ["owner"],
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    const res = await makeRequest("GET", "/api/issues");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; issues: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it("returns 401 when needsAuth", async () => {
    vi.mocked(dashboardData.getIssuesCached).mockResolvedValue({
      ok: false,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("GET", "/api/issues");
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /api/prs", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 200 with ok shape", async () => {
    vi.mocked(dashboardData.getPullRequestsCached).mockResolvedValue({
      ok: true,
      pullRequests: [],
      owners: ["owner"],
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    const res = await makeRequest("GET", "/api/prs");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; pullRequests: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.pullRequests)).toBe(true);
  });

  it("returns 401 when needsAuth", async () => {
    vi.mocked(dashboardData.getPullRequestsCached).mockResolvedValue({
      ok: false,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("GET", "/api/prs");
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /api/ci-health
// ---------------------------------------------------------------------------

describe("GET /api/ci-health", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 200 with ok shape", async () => {
    vi.mocked(ciHealth.getCIHealthCached).mockResolvedValue({
      ok: true,
      repos: [],
      fetchedAt: "2026-01-01T00:00:00Z",
    });
    const res = await makeRequest("GET", "/api/ci-health");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 401 when needsAuth", async () => {
    vi.mocked(ciHealth.getCIHealthCached).mockResolvedValue({
      ok: false,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("GET", "/api/ci-health");
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /api/thread
// ---------------------------------------------------------------------------

describe("GET /api/thread", () => {
  afterEach(() => vi.clearAllMocks());

  const threadOkResult = {
    ok: true as const,
    item: {
      author: { login: "alice", avatarUrl: "", url: "" },
      title: "Bug: the thing breaks",
      bodyHtml: "<p>Details.</p>",
      createdAt: "2026-05-01T10:00:00Z",
      state: "open",
      url: "https://github.com/owner/repo/issues/1",
      isPullRequest: false,
    },
    entries: [],
    truncated: false,
  };

  it("returns 400 when repo is missing", async () => {
    const res = await makeRequest("GET", "/api/thread?number=1");
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/repo/i);
  });

  it("returns 400 when repo is invalid", async () => {
    const res = await makeRequest("GET", "/api/thread?repo=notavalidrepo&number=1");
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it("returns 400 when number is missing", async () => {
    const res = await makeRequest("GET", "/api/thread?repo=owner/repo");
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/number/i);
  });

  it("returns 400 when number is zero", async () => {
    const res = await makeRequest("GET", "/api/thread?repo=owner/repo&number=0");
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when number is negative", async () => {
    const res = await makeRequest("GET", "/api/thread?repo=owner/repo&number=-5");
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(null);
    const res = await makeRequest("GET", "/api/thread?repo=owner/repo&number=1");
    expect(res.statusCode).toBe(401);
    const body = parseBody(res) as { needsAuth: boolean };
    expect(body.needsAuth).toBe(true);
  });

  it("returns 200 with thread shape when provider succeeds", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);
    const stubProvider = makeStubProvider({
      fetchThread: vi.fn().mockResolvedValue(threadOkResult),
    });
    vi.mocked(registry.getProviderForAccount).mockResolvedValue(stubProvider as never);

    const res = await makeRequest("GET", "/api/thread?repo=owner/repo&number=1");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; item: { title: string } };
    expect(body.ok).toBe(true);
    expect(body.item.title).toBe("Bug: the thing breaks");
  });

  it("propagates provider error with correct status code", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);
    const stubProvider = makeStubProvider({
      fetchThread: vi.fn().mockResolvedValue({ ok: false, status: 404, error: "not found" }),
    });
    vi.mocked(registry.getProviderForAccount).mockResolvedValue(stubProvider as never);

    const res = await makeRequest("GET", "/api/thread?repo=owner/repo&number=1");
    expect(res.statusCode).toBe(404);
    const body = parseBody(res) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("not found");
  });
});

// ---------------------------------------------------------------------------
// /api/summary
// ---------------------------------------------------------------------------

describe("POST /api/summary", () => {
  afterEach(() => vi.clearAllMocks());

  const settingsWithKey = {
    summaryModel: "claude-haiku-4-5" as const,
    summaryEnabled: true,
    contribFilter: "",
    anthropicConfigured: true,
  };

  const settingsNoKey = {
    summaryModel: "claude-haiku-4-5" as const,
    summaryEnabled: true,
    contribFilter: "",
    anthropicConfigured: false,
  };

  const settingsDisabled = {
    summaryModel: "claude-haiku-4-5" as const,
    summaryEnabled: false,
    contribFilter: "",
    anthropicConfigured: true,
  };

  it("returns 405 for non-POST", async () => {
    const res = await makeRequest("GET", "/api/summary");
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 with needsKey when no API key configured", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(settingsNoKey);
    const res = await makeRequest("POST", "/api/summary", { repo: "owner/repo", number: 1 });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { ok: boolean; needsKey: boolean };
    expect(body.needsKey).toBe(true);
  });

  it("returns 400 when summaries are disabled", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(settingsDisabled);
    const res = await makeRequest("POST", "/api/summary", { repo: "owner/repo", number: 1 });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/disabled/i);
  });

  it("returns cached hit without calling provider", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(settingsWithKey);
    vi.mocked(summaryCache.getCachedSummary).mockResolvedValue({
      summary: "This is a cached summary.",
      generatedAt: "2026-01-01T00:00:00Z",
    });

    const res = await makeRequest("POST", "/api/summary", { repo: "owner/repo", number: 1 });
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; summary: string; cached: boolean };
    expect(body.ok).toBe(true);
    expect(body.cached).toBe(true);
    expect(body.summary).toBe("This is a cached summary.");
    // provider should NOT have been called
    expect(registry.getProviderForAccount).not.toHaveBeenCalled();
  });

  it("bypasses cache and calls provider when fresh=true", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(settingsWithKey);
    vi.mocked(summaryCache.getCachedSummary).mockResolvedValue({
      summary: "old cached summary",
      generatedAt: "2026-01-01T00:00:00Z",
    });
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);

    const threadResult = {
      ok: true as const,
      item: {
        author: { login: "alice", avatarUrl: "", url: "" },
        title: "Bug report",
        bodyHtml: "<p>Something broke</p>",
        createdAt: "2026-05-01T10:00:00Z",
        state: "open",
        url: "https://github.com/owner/repo/issues/1",
        isPullRequest: false,
      },
      entries: [],
      truncated: false,
    };
    const stubProvider = makeStubProvider({
      fetchThread: vi.fn().mockResolvedValue(threadResult),
    });
    vi.mocked(registry.getProviderForAccount).mockResolvedValue(stubProvider as never);
    vi.mocked(anthropicSummary.summariseThread).mockResolvedValue({
      ok: true,
      summary: "Fresh summary text.",
      model: "claude-haiku-4-5",
    });

    const res = await makeRequest("POST", "/api/summary", { repo: "owner/repo", number: 1, fresh: true });
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; summary: string; cached: boolean };
    expect(body.ok).toBe(true);
    expect(body.cached).toBe(false);
    expect(body.summary).toBe("Fresh summary text.");
    // Cache should NOT have been read (fresh bypasses)
    expect(summaryCache.getCachedSummary).not.toHaveBeenCalled();
  });

  it("returns 400 for missing or invalid repo", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(settingsWithKey);
    vi.mocked(summaryCache.getCachedSummary).mockResolvedValue(null);

    const res = await makeRequest("POST", "/api/summary", { repo: "notvalid", number: 1 });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns 400 for invalid number", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(settingsWithKey);
    vi.mocked(summaryCache.getCachedSummary).mockResolvedValue(null);

    const res = await makeRequest("POST", "/api/summary", { repo: "owner/repo", number: 0 });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /api/settings
// ---------------------------------------------------------------------------

describe("/api/settings", () => {
  afterEach(() => vi.clearAllMocks());

  const publicSettings = {
    summaryModel: "claude-haiku-4-5" as const,
    summaryEnabled: true,
    contribFilter: "",
    anthropicConfigured: true,
  };

  it("GET returns 200 with settings shape that does NOT include anthropicApiKey", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(publicSettings);

    const res = await makeRequest("GET", "/api/settings");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; settings: Record<string, unknown> };
    expect(body.ok).toBe(true);
    // Must have anthropicConfigured (the boolean)
    expect(body.settings.anthropicConfigured).toBe(true);
    // Must NOT expose the raw key
    expect(body.settings.anthropicApiKey).toBeUndefined();
  });

  it("GET settings shape has summaryModel, summaryEnabled, contribFilter, anthropicConfigured", async () => {
    vi.mocked(settingsStore.getPublicSettings).mockResolvedValue(publicSettings);

    const res = await makeRequest("GET", "/api/settings");
    const body = parseBody(res) as { settings: Record<string, unknown> };
    expect(Object.keys(body.settings).sort()).toEqual(
      ["anthropicConfigured", "contribFilter", "summaryEnabled", "summaryModel"].sort(),
    );
  });

  it("PUT updates settings and returns updated public settings", async () => {
    const updatedSettings = { ...publicSettings, summaryEnabled: false };
    vi.mocked(settingsStore.updateSettings).mockResolvedValue(updatedSettings);

    const res = await makeRequest("PUT", "/api/settings", { summaryEnabled: false });
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; settings: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.settings.summaryEnabled).toBe(false);
    expect(body.settings.anthropicApiKey).toBeUndefined();
  });

  it("PUT returns 400 on invalid JSON body", async () => {
    // Simulate invalid JSON by sending a non-JSON string
    // We need a special helper for this case
    const chunks = [Buffer.from("{bad json")];
    let chunkIndex = 0;

    const req = {
      method: "PUT",
      url: "/api/settings",
      headers: { "content-type": "application/json" },
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (chunkIndex < chunks.length) {
              return Promise.resolve({ value: chunks[chunkIndex++], done: false });
            }
            return Promise.resolve({ value: undefined, done: true });
          },
        };
      },
    } as unknown as IncomingMessage;

    const result = await new Promise<MockResponse>((resolve) => {
      const captured: MockResponse = { statusCode: 0, headers: {}, body: "" };
      const bodyParts: Buffer[] = [];

      const res = {
        writeHead(status: number) { captured.statusCode = status; },
        end(data?: Buffer | string) {
          if (data) bodyParts.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
          captured.body = Buffer.concat(bodyParts).toString("utf-8");
          resolve(captured);
        },
      } as unknown as ServerResponse;

      handle(req, res).catch(() => resolve(captured));
    });

    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid JSON/i);
  });

  it("responds 405 for other methods", async () => {
    const res = await makeRequest("DELETE", "/api/settings");
    expect(res.statusCode).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// /api/comment
// ---------------------------------------------------------------------------

describe("POST /api/comment", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 405 for non-POST", async () => {
    const res = await makeRequest("GET", "/api/comment");
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 when repo is missing", async () => {
    const res = await makeRequest("POST", "/api/comment", { number: 1, body: "hello" });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { error: string };
    expect(body.error).toMatch(/repo/i);
  });

  it("returns 400 when repo is invalid", async () => {
    const res = await makeRequest("POST", "/api/comment", { repo: "notvalid", number: 1, body: "hello" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when number is missing", async () => {
    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", body: "hello" });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { error: string };
    expect(body.error).toMatch(/number/i);
  });

  it("returns 400 when number is zero", async () => {
    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", number: 0, body: "hello" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", number: 1, body: "   " });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { error: string };
    expect(body.error).toMatch(/body/i);
  });

  it("returns 401 when not authenticated", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(null);

    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", number: 1, body: "Hello world" });
    expect(res.statusCode).toBe(401);
    const body = parseBody(res) as { needsAuth: boolean };
    expect(body.needsAuth).toBe(true);
  });

  it("returns 200 with { ok, htmlUrl } on success", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);
    const stubProvider = makeStubProvider({
      createComment: vi.fn().mockResolvedValue({
        ok: true,
        htmlUrl: "https://github.com/owner/repo/issues/1#issuecomment-42",
      }),
    });
    vi.mocked(registry.getProviderForAccount).mockResolvedValue(stubProvider as never);

    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", number: 1, body: "Hello world" });
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; htmlUrl: string };
    expect(body.ok).toBe(true);
    expect(body.htmlUrl).toBe("https://github.com/owner/repo/issues/1#issuecomment-42");
  });

  it("returns 401 with needsAuth when provider returns needsAuth", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);
    const stubProvider = makeStubProvider({
      createComment: vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        error: "authentication required",
        needsAuth: true,
      }),
    });
    vi.mocked(registry.getProviderForAccount).mockResolvedValue(stubProvider as never);

    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", number: 1, body: "Hello" });
    expect(res.statusCode).toBe(401);
    const body = parseBody(res) as { ok: boolean; needsAuth: boolean };
    expect(body.ok).toBe(false);
    expect(body.needsAuth).toBe(true);
  });

  it("returns appropriate status from provider error (e.g. 403)", async () => {
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);
    const stubProvider = makeStubProvider({
      createComment: vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        error: "Forbidden",
      }),
    });
    vi.mocked(registry.getProviderForAccount).mockResolvedValue(stubProvider as never);

    const res = await makeRequest("POST", "/api/comment", { repo: "owner/repo", number: 1, body: "Hello" });
    expect(res.statusCode).toBe(403);
  });
});
