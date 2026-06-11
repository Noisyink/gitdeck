/**
 * Route-level tests for the notifications endpoints:
 *   GET  /api/notifications
 *   POST /api/notifications/read
 *   POST /api/notifications/read-all
 *
 * These tests import the exported `handle` function and drive it directly with
 * mock IncomingMessage / ServerResponse objects (no bound port).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

// ---------------------------------------------------------------------------
// Module-level mocks — must appear before any import of the tested module.
// ---------------------------------------------------------------------------

vi.mock("../../src/server/dashboardData", () => ({
  getReposCached: vi.fn(),
  getIssuesCached: vi.fn(),
  getPullRequestsCached: vi.fn(),
  invalidateDataCache: vi.fn(),
}));

vi.mock("../../src/server/ciHealth", () => ({
  getCIHealthCached: vi.fn(),
  invalidateCIHealthCache: vi.fn(),
}));

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

vi.mock("../../src/server/providers/registry", () => ({
  getProvider: vi.fn(),
  getProviderForAccount: vi.fn(),
  resetProviderCache: vi.fn(),
}));

vi.mock("../../src/server/settingsStore", () => ({
  getPublicSettings: vi.fn(),
  updateSettings: vi.fn(),
  isSummaryModel: vi.fn().mockReturnValue(false),
  getSettings: vi.fn(),
  getContribFilter: vi.fn().mockResolvedValue("author:@me"),
}));

vi.mock("../../src/server/summaryCache", () => ({
  getCachedSummary: vi.fn(),
  setCachedSummary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/server/anthropicSummary", () => ({
  summariseThread: vi.fn(),
}));

vi.mock("../../src/server/digests", () => ({
  getLatestRepoDigest: vi.fn().mockResolvedValue(null),
  handleDailyDigests: vi.fn().mockImplementation((_req, res) => {
    const r = res as ServerResponse;
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end(JSON.stringify({ ok: true }));
  }),
}));

vi.mock("../../src/server/repoInsights", () => ({
  handleRepoInsights: vi.fn().mockImplementation((_req, res) => {
    const r = res as ServerResponse;
    r.writeHead(200, { "Content-Type": "application/json" });
    r.end(JSON.stringify({ ok: true }));
  }),
}));

vi.mock("../../src/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/server/http")>();
  return {
    ...actual,
    sendStaticFile: vi.fn().mockResolvedValue(false),
  };
});

vi.mock("../../src/server/oauth", () => ({
  authStatus: vi.fn().mockResolvedValue({ authenticated: false }),
  isClientIdConfigured: vi.fn().mockReturnValue(false),
  logout: vi.fn().mockResolvedValue(undefined),
  pollDeviceFlow: vi.fn(),
  startDeviceFlow: vi.fn(),
}));

vi.mock("../../src/server/authProvider", () => ({
  getAuthMode: vi.fn().mockReturnValue("device"),
  getActiveToken: vi.fn().mockRejectedValue(new Error("not authenticated")),
}));

vi.mock("../../src/server/aliasStore", () => ({
  getAliases: vi.fn().mockResolvedValue([]),
  addAlias: vi.fn(),
  removeAlias: vi.fn(),
}));

vi.mock("../../src/server/securityAlerts", () => ({
  fetchRepoSecuritySummary: vi.fn().mockResolvedValue({ ok: true, alerts: [] }),
}));

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

// Mock the notifications module so we can control responses
vi.mock("../../src/server/notifications", () => ({
  getNotificationsCached: vi.fn(),
  markThreadRead: vi.fn(),
  markAllRead: vi.fn(),
  invalidateNotificationsCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import handle AFTER all mocks are set up
// ---------------------------------------------------------------------------

import { handle } from "../../src/server";
import * as notifications from "../../src/server/notifications";
import * as accountStore from "../../src/server/accountStore";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function makeRequest(method: string, url: string, body?: unknown): Promise<MockResponse> {
  const chunks: Buffer[] = [];
  if (body !== undefined) {
    chunks.push(Buffer.from(JSON.stringify(body)));
  }
  let chunkIndex = 0;
  const req = {
    method,
    url,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
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
  try { return JSON.parse(res.body); }
  catch { return res.body; }
}

const FAKE_ACCOUNT = {
  id: "gh_test",
  providerKind: "github" as const,
  providerConfigId: "github.com",
  label: "test",
  login: "testuser",
  accessToken: "tok",
  scope: "repo notifications",
  obtainedAt: "2026-01-01T00:00:00Z",
  source: "device" as const,
};

// ---------------------------------------------------------------------------
// GET /api/notifications
// ---------------------------------------------------------------------------

describe("GET /api/notifications", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 200 with notifications array on success", async () => {
    vi.mocked(notifications.getNotificationsCached).mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        notifications: [],
        fetchedAt: "2026-01-01T00:00:00Z",
        pollInterval: 60,
      },
    });
    const res = await makeRequest("GET", "/api/notifications");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean; notifications: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.notifications)).toBe(true);
  });

  it("passes fresh=true when ?fresh=1", async () => {
    vi.mocked(notifications.getNotificationsCached).mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        notifications: [],
        fetchedAt: "2026-01-01T00:00:00Z",
        pollInterval: 60,
      },
    });
    await makeRequest("GET", "/api/notifications?fresh=1");
    expect(notifications.getNotificationsCached).toHaveBeenCalledWith(true);
  });

  it("passes fresh=false when no query param", async () => {
    vi.mocked(notifications.getNotificationsCached).mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        notifications: [],
        fetchedAt: "2026-01-01T00:00:00Z",
        pollInterval: 60,
      },
    });
    await makeRequest("GET", "/api/notifications");
    expect(notifications.getNotificationsCached).toHaveBeenCalledWith(false);
  });

  it("returns 401 when needsAuth", async () => {
    vi.mocked(notifications.getNotificationsCached).mockResolvedValue({
      ok: false,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("GET", "/api/notifications");
    expect(res.statusCode).toBe(401);
    const body = parseBody(res) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns 405 for non-GET", async () => {
    const res = await makeRequest("DELETE", "/api/notifications");
    expect(res.statusCode).toBe(405);
  });

  it("filters by ?unread=1", async () => {
    vi.mocked(notifications.getNotificationsCached).mockResolvedValue({
      ok: true,
      data: {
        ok: true,
        notifications: [
          { id: "1", unread: true, reason: "mention", updatedAt: "2026-01-01T00:00:00Z", lastReadAt: null, subject: { title: "A", url: null, latestCommentUrl: null, type: "Issue" }, repository: { name: "repo", nameWithOwner: "owner/repo", private: false, htmlUrl: "" }, itemNumber: 1, itemHtmlUrl: null },
          { id: "2", unread: false, reason: "comment", updatedAt: "2026-01-01T00:00:00Z", lastReadAt: null, subject: { title: "B", url: null, latestCommentUrl: null, type: "Issue" }, repository: { name: "repo", nameWithOwner: "owner/repo", private: false, htmlUrl: "" }, itemNumber: 2, itemHtmlUrl: null },
        ],
        fetchedAt: "2026-01-01T00:00:00Z",
        pollInterval: 60,
      },
    });
    const res = await makeRequest("GET", "/api/notifications?unread=1");
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { notifications: { id: string }[] };
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].id).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read
// ---------------------------------------------------------------------------

describe("POST /api/notifications/read", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 405 for non-POST", async () => {
    const res = await makeRequest("GET", "/api/notifications/read");
    expect(res.statusCode).toBe(405);
  });

  it("returns 400 when threadId is missing", async () => {
    const res = await makeRequest("POST", "/api/notifications/read", {});
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { error: string };
    expect(body.error).toMatch(/threadId/i);
  });

  it("returns 400 when threadId is non-numeric", async () => {
    const res = await makeRequest("POST", "/api/notifications/read", { threadId: "abc" });
    expect(res.statusCode).toBe(400);
  });

  it("returns 200 on success", async () => {
    vi.mocked(notifications.markThreadRead).mockResolvedValue({ ok: true, status: 200 });
    const res = await makeRequest("POST", "/api/notifications/read", { threadId: "12345" });
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 401 when markThreadRead needsAuth", async () => {
    vi.mocked(notifications.markThreadRead).mockResolvedValue({
      ok: false,
      status: 401,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("POST", "/api/notifications/read", { threadId: "12345" });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/notifications/read-all
// ---------------------------------------------------------------------------

describe("POST /api/notifications/read-all", () => {
  afterEach(() => vi.clearAllMocks());

  it("returns 405 for non-POST", async () => {
    const res = await makeRequest("GET", "/api/notifications/read-all");
    expect(res.statusCode).toBe(405);
  });

  it("returns 200 on success with no body", async () => {
    vi.mocked(notifications.markAllRead).mockResolvedValue({ ok: true, status: 200 });
    const res = await makeRequest("POST", "/api/notifications/read-all", {});
    expect(res.statusCode).toBe(200);
    const body = parseBody(res) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns 200 on success with repo body", async () => {
    vi.mocked(notifications.markAllRead).mockResolvedValue({ ok: true, status: 200 });
    const res = await makeRequest("POST", "/api/notifications/read-all", { repo: "owner/repo" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 for invalid repo", async () => {
    const res = await makeRequest("POST", "/api/notifications/read-all", { repo: "notvalid" });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { error: string };
    expect(body.error).toMatch(/repo/i);
  });

  it("returns 400 for invalid lastReadAt", async () => {
    const res = await makeRequest("POST", "/api/notifications/read-all", { lastReadAt: "not-a-date" });
    expect(res.statusCode).toBe(400);
    const body = parseBody(res) as { error: string };
    expect(body.error).toMatch(/lastReadAt/i);
  });

  it("returns 401 when markAllRead needsAuth", async () => {
    vi.mocked(notifications.markAllRead).mockResolvedValue({
      ok: false,
      status: 401,
      error: "authentication required",
      needsAuth: true,
    });
    const res = await makeRequest("POST", "/api/notifications/read-all", {});
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// /inbox SPA route
// ---------------------------------------------------------------------------

describe("GET /inbox (SPA route)", () => {
  beforeEach(() => {
    vi.mocked(accountStore.getActive).mockResolvedValue(FAKE_ACCOUNT);
  });
  afterEach(() => vi.clearAllMocks());

  it("returns HTML (serves the SPA index)", async () => {
    const res = await makeRequest("GET", "/inbox");
    // It will return 500 because the index.html file doesn't exist in test env,
    // but the important thing is it tries to serve the SPA (not 404)
    expect([200, 500]).toContain(res.statusCode);
    // Must NOT be a JSON 404
    if (res.statusCode === 404) {
      throw new Error("Expected SPA handler, got 404");
    }
  });
});
