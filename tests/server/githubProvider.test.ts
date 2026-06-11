/**
 * Characterization tests for GitHubProvider fork methods.
 *
 * These tests stub the global `fetch` via vi.fn() and assert the normalized
 * output of the provider methods that back the fork features:
 *   - fetchThread  (timeline normalization, review-comment merge, truncation)
 *   - createComment (success + 401)
 *   - listIssues / listPullRequests (contrib-filter query, archived-repo skip)
 *
 * They must remain passing through Slice 5 (provider seam collapse) to confirm
 * no regression in fork behaviour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock the settingsStore so getContribFilter returns a predictable value
// without hitting the filesystem.
// ---------------------------------------------------------------------------
vi.mock("../../src/server/settingsStore", () => ({
  getContribFilter: vi.fn().mockResolvedValue("author:@me"),
}));

import { GitHubProvider } from "../../src/server/providers/github";
import type { Account, ProviderConfig } from "../../src/server/providers/types";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const TEST_CONFIG: ProviderConfig = {
  id: "github.com",
  kind: "github",
  label: "GitHub",
  baseUrl: "https://api.github.com",
  webUrl: "https://github.com",
  graphqlUrl: "https://api.github.com/graphql",
  oauthDeviceCodeUrl: "https://github.com/login/device/code",
  oauthTokenUrl: "https://github.com/login/oauth/access_token",
  oauthScopes: "repo read:org project read:user user:email",
  userAgent: "gitdeck-test",
};

const TEST_ACCOUNT: Account = {
  id: "gh_test_github.com",
  providerKind: "github",
  providerConfigId: "github.com",
  label: "test (github.com)",
  login: "testuser",
  accessToken: "ghs_test_token",
  scope: "repo read:org project",
  obtainedAt: "2026-01-01T00:00:00Z",
  source: "device",
};

function makeProvider(): GitHubProvider {
  return new GitHubProvider(TEST_CONFIG);
}

// Helper: build a minimal fetch mock that returns a single JSON response.
function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// Helper: build a fetch mock that sequences through multiple responses in order.
function mockFetchSequence(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>): ReturnType<typeof vi.fn> {
  const mocks = responses.map(({ status, body, headers = {} }) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }));
  const fn = vi.fn();
  for (const mock of mocks) fn.mockResolvedValueOnce(mock);
  return fn;
}

// ---------------------------------------------------------------------------
// createComment
// ---------------------------------------------------------------------------

describe("GitHubProvider.createComment", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns { ok: true, htmlUrl } on a 201 success", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch(201, { html_url: "https://github.com/owner/repo/issues/42#issuecomment-999" }),
    );

    const result = await provider.createComment(TEST_ACCOUNT, "owner/repo", 42, "Hello world");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.htmlUrl).toBe("https://github.com/owner/repo/issues/42#issuecomment-999");
    }
  });

  it("sends to the issues/comments endpoint with the correct body", async () => {
    const provider = makeProvider();
    const fetchSpy = mockFetch(201, { html_url: "https://github.com/a/b/issues/1#issuecomment-1" });
    vi.stubGlobal("fetch", fetchSpy);

    await provider.createComment(TEST_ACCOUNT, "a/b", 1, "Test body");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/a/b/issues/1/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ body: "Test body" });
  });

  it("returns { ok: false, needsAuth: true } on a 401", async () => {
    const provider = makeProvider();
    vi.stubGlobal("fetch", mockFetch(401, { message: "Bad credentials" }));

    const result = await provider.createComment(TEST_ACCOUNT, "owner/repo", 7, "hi");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.needsAuth).toBe(true);
    }
  });

  it("returns { ok: false } on a non-auth HTTP error", async () => {
    const provider = makeProvider();
    vi.stubGlobal("fetch", mockFetch(403, "Forbidden"));

    const result = await provider.createComment(TEST_ACCOUNT, "owner/repo", 7, "hi");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.needsAuth).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// fetchThread — timeline normalisation
// ---------------------------------------------------------------------------

describe("GitHubProvider.fetchThread", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Minimal raw issue body matching the REST html media-type response.
  const RAW_ISSUE = {
    user: { login: "alice", avatar_url: "https://github.com/alice.png", html_url: "https://github.com/alice" },
    title: "Bug: the thing breaks",
    body_html: "<p>Details here.</p>",
    created_at: "2026-05-01T10:00:00Z",
    state: "open",
    html_url: "https://github.com/owner/repo/issues/3",
    pull_request: undefined,
  };

  it("returns the issue item with correct ThreadItem shape", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },          // issue
        { status: 200, body: [] },                  // timeline (empty)
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.title).toBe("Bug: the thing breaks");
      expect(result.item.bodyHtml).toBe("<p>Details here.</p>");
      expect(result.item.isPullRequest).toBe(false);
      expect(result.item.author?.login).toBe("alice");
      expect(result.item.state).toBe("open");
      expect(result.truncated).toBe(false);
    }
  });

  it("normalises a 'commented' timeline event to kind: comment", async () => {
    const provider = makeProvider();
    const events = [
      {
        event: "commented",
        user: { login: "bob", avatar_url: "", html_url: "" },
        created_at: "2026-05-01T11:00:00Z",
        body_html: "<p>My comment</p>",
        html_url: "https://github.com/owner/repo/issues/3#issuecomment-1",
      },
    ];
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(1);
      const entry = result.entries[0];
      expect(entry.kind).toBe("comment");
      if (entry.kind === "comment") {
        expect(entry.actor?.login).toBe("bob");
        expect(entry.bodyHtml).toBe("<p>My comment</p>");
        expect(entry.url).toBe("https://github.com/owner/repo/issues/3#issuecomment-1");
      }
    }
  });

  it("normalises a 'reviewed' event with body to kind: review", async () => {
    const provider = makeProvider();
    const events = [
      {
        event: "reviewed",
        user: { login: "carol", avatar_url: "", html_url: "" },
        submitted_at: "2026-05-02T09:00:00Z",
        body_html: "<p>LGTM!</p>",
        state: "approved",
        html_url: "https://github.com/owner/repo/pull/5#pullrequestreview-1",
      },
    ];
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(1);
      const entry = result.entries[0];
      expect(entry.kind).toBe("review");
      if (entry.kind === "review") {
        expect(entry.actor?.login).toBe("carol");
        expect(entry.state).toBe("approved");
        expect(entry.bodyHtml).toBe("<p>LGTM!</p>");
      }
    }
  });

  it("drops empty 'commented' reviews (no body, state=commented)", async () => {
    const provider = makeProvider();
    const events = [
      {
        event: "reviewed",
        user: { login: "dave", avatar_url: "", html_url: "" },
        submitted_at: "2026-05-02T08:00:00Z",
        body_html: "",
        body: "",
        state: "commented",
      },
    ];
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(0);
    }
  });

  it("normalises known event kinds using the TIMELINE_EVENT_DETAIL map", async () => {
    const provider = makeProvider();
    const events = [
      {
        event: "labeled",
        actor: { login: "eve", avatar_url: "", html_url: "" },
        created_at: "2026-05-01T12:00:00Z",
        label: { name: "bug" },
      },
      {
        event: "closed",
        actor: { login: "eve", avatar_url: "", html_url: "" },
        created_at: "2026-05-01T13:00:00Z",
      },
      {
        event: "renamed",
        actor: { login: "eve", avatar_url: "", html_url: "" },
        created_at: "2026-05-01T14:00:00Z",
        rename: { from: "Old title", to: "New title" },
      },
    ];
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(3);
      const [labeled, closed, renamed] = result.entries;

      expect(labeled.kind).toBe("event");
      if (labeled.kind === "event") {
        expect(labeled.eventType).toBe("labeled");
        expect(labeled.detail).toBe("bug");
      }

      expect(closed.kind).toBe("event");
      if (closed.kind === "event") {
        expect(closed.eventType).toBe("closed");
        expect(closed.detail).toBe("");
      }

      expect(renamed.kind).toBe("event");
      if (renamed.kind === "event") {
        expect(renamed.eventType).toBe("renamed");
        expect(renamed.detail).toBe("New title");
      }
    }
  });

  it("ignores unknown event types (returns null from normalizeTimelineEvent)", async () => {
    const provider = makeProvider();
    const events = [
      { event: "unknown_future_event", actor: { login: "x" }, created_at: "2026-05-01T10:00:00Z" },
    ];
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(0);
    }
  });

  it("sets truncated=true when timeline has exactly 100 events", async () => {
    const provider = makeProvider();
    // Build 100 identical comment events.
    const events = Array.from({ length: 100 }, (_, i) => ({
      event: "commented",
      user: { login: "user", avatar_url: "", html_url: "" },
      created_at: `2026-05-01T${String(i).padStart(2, "0")}:00:00Z`,
      body_html: `<p>comment ${i}</p>`,
      html_url: `https://github.com/owner/repo/issues/3#comment-${i}`,
    }));
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.truncated).toBe(true);
      expect(result.entries).toHaveLength(100);
    }
  });

  it("sorts entries chronologically regardless of source order", async () => {
    const provider = makeProvider();
    const events = [
      {
        event: "commented",
        user: { login: "bob", avatar_url: "", html_url: "" },
        created_at: "2026-05-01T15:00:00Z",
        body_html: "<p>second</p>",
        html_url: "https://github.com/owner/repo/issues/3#c2",
      },
      {
        event: "commented",
        user: { login: "alice", avatar_url: "", html_url: "" },
        created_at: "2026-05-01T10:00:00Z",
        body_html: "<p>first</p>",
        html_url: "https://github.com/owner/repo/issues/3#c1",
      },
    ];
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: RAW_ISSUE },
        { status: 200, body: events },
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries[0].createdAt).toBe("2026-05-01T10:00:00Z");
      expect(result.entries[1].createdAt).toBe("2026-05-01T15:00:00Z");
    }
  });

  it("merges PR inline review-comments from the separate /pulls/comments endpoint", async () => {
    const provider = makeProvider();
    const rawPR = {
      ...RAW_ISSUE,
      pull_request: { url: "https://api.github.com/repos/owner/repo/pulls/5" },
    };
    const reviewComment = {
      user: { login: "frank", avatar_url: "", html_url: "" },
      body_html: "<p>nit: rename this</p>",
      html_url: "https://github.com/owner/repo/pull/5#r1",
      created_at: "2026-05-01T12:30:00Z",
      path: "src/index.ts",
    };
    vi.stubGlobal(
      "fetch",
      mockFetchSequence([
        { status: 200, body: rawPR },          // issue (PR)
        { status: 200, body: [] },              // timeline
        { status: 200, body: [reviewComment] }, // PR review comments
      ]),
    );

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 5);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.item.isPullRequest).toBe(true);
      const rc = result.entries.find((entry) => entry.kind === "review-comment");
      expect(rc).toBeDefined();
      if (rc?.kind === "review-comment") {
        expect(rc.actor?.login).toBe("frank");
        expect(rc.path).toBe("src/index.ts");
        expect(rc.bodyHtml).toBe("<p>nit: rename this</p>");
      }
    }
  });

  it("returns { ok: false, needsAuth: true } when the issue fetch returns 401", async () => {
    const provider = makeProvider();
    vi.stubGlobal("fetch", mockFetch(401, { message: "Bad credentials" }));

    const result = await provider.fetchThread(TEST_ACCOUNT, "owner/repo", 3);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.needsAuth).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// listIssues — contrib-filter query string + archived-repo skip
// ---------------------------------------------------------------------------

describe("GitHubProvider.listIssues", () => {
  afterEach(() => vi.unstubAllGlobals());

  // GraphQL calls go through gqlCall which expects { data: <payload> }
  function makeIssueSearchResponse(
    nodes: Array<{
      number: number;
      title: string;
      isArchived?: boolean;
    }>,
    hasNextPage = false,
  ) {
    return {
      data: {
        search: {
          pageInfo: { endCursor: null, hasNextPage },
          nodes: nodes.map(({ number, title, isArchived = false }) => ({
            __typename: "Issue",
            number,
            title,
            url: `https://github.com/owner/repo/issues/${number}`,
            createdAt: "2026-05-01T00:00:00Z",
            updatedAt: "2026-05-01T00:00:00Z",
            author: { login: "alice", url: "https://github.com/alice" },
            repository: { name: "repo", nameWithOwner: "owner/repo", isArchived },
            labels: { nodes: [] },
            comments: { totalCount: 0 },
            assignees: { nodes: [] },
          })),
        },
      },
    };
  }

  it("builds the correct query string: is:issue is:open author:@me", async () => {
    const provider = makeProvider();
    const fetchSpy = mockFetch(200, makeIssueSearchResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    await provider.listIssues(TEST_ACCOUNT, ["owner"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { variables: { q: string } };
    expect(body.variables.q).toBe("is:issue is:open author:@me");
  });

  it("returns normalised GhIssue objects for non-archived repos", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch(200, makeIssueSearchResponse([{ number: 42, title: "Fix bug" }])),
    );

    const issues = await provider.listIssues(TEST_ACCOUNT, ["owner"]);

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(42);
    expect(issues[0].title).toBe("Fix bug");
    expect(issues[0].repository.nameWithOwner).toBe("owner/repo");
  });

  it("skips items where repository.isArchived is true", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch(
        200,
        makeIssueSearchResponse([
          { number: 1, title: "Live issue" },
          { number: 2, title: "Archived issue", isArchived: true },
        ]),
      ),
    );

    const issues = await provider.listIssues(TEST_ACCOUNT, ["owner"]);

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it("skips nodes with __typename !== Issue", async () => {
    const provider = makeProvider();
    const response = {
      data: {
        search: {
          pageInfo: { endCursor: null, hasNextPage: false },
          nodes: [
            { __typename: "PullRequest", number: 9, title: "should be ignored" },
            {
              __typename: "Issue",
              number: 5,
              title: "real issue",
              url: "https://github.com/owner/repo/issues/5",
              createdAt: "2026-05-01T00:00:00Z",
              updatedAt: "2026-05-01T00:00:00Z",
              author: { login: "alice", url: "https://github.com/alice" },
              repository: { name: "repo", nameWithOwner: "owner/repo", isArchived: false },
              labels: { nodes: [] },
              comments: { totalCount: 0 },
              assignees: { nodes: [] },
            },
          ],
        },
      },
    };
    vi.stubGlobal("fetch", mockFetch(200, response));

    const issues = await provider.listIssues(TEST_ACCOUNT, ["owner"]);

    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// listPullRequests — contrib-filter query string + archived-repo skip
// ---------------------------------------------------------------------------

describe("GitHubProvider.listPullRequests", () => {
  afterEach(() => vi.unstubAllGlobals());

  // GraphQL calls go through gqlCall which expects { data: <payload> }
  function makePRSearchResponse(
    nodes: Array<{
      number: number;
      title: string;
      isArchived?: boolean;
    }>,
    hasNextPage = false,
  ) {
    return {
      data: {
        search: {
          pageInfo: { endCursor: null, hasNextPage },
          nodes: nodes.map(({ number, title, isArchived = false }) => ({
            __typename: "PullRequest",
            number,
            title,
            url: `https://github.com/owner/repo/pull/${number}`,
            createdAt: "2026-05-01T00:00:00Z",
            updatedAt: "2026-05-01T00:00:00Z",
            isDraft: false,
            reviewDecision: null,
            author: { login: "alice", url: "https://github.com/alice" },
            repository: { name: "repo", nameWithOwner: "owner/repo", isArchived },
            labels: { nodes: [] },
            comments: { totalCount: 0 },
            reviews: { totalCount: 0 },
            assignees: { nodes: [] },
            additions: 10,
            deletions: 2,
            changedFiles: 1,
            baseRefName: "main",
            headRefName: "fix-thing",
          })),
        },
      },
    };
  }

  it("builds the correct query string: is:pr is:open author:@me", async () => {
    const provider = makeProvider();
    const fetchSpy = mockFetch(200, makePRSearchResponse([]));
    vi.stubGlobal("fetch", fetchSpy);

    await provider.listPullRequests(TEST_ACCOUNT, ["owner"]);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { variables: { q: string } };
    expect(body.variables.q).toBe("is:pr is:open author:@me");
  });

  it("returns normalised GhPullRequest objects for non-archived repos", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch(200, makePRSearchResponse([{ number: 17, title: "Add feature" }])),
    );

    const prs = await provider.listPullRequests(TEST_ACCOUNT, ["owner"]);

    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(17);
    expect(prs[0].title).toBe("Add feature");
    expect(prs[0].baseRefName).toBe("main");
    expect(prs[0].headRefName).toBe("fix-thing");
  });

  it("skips items where repository.isArchived is true", async () => {
    const provider = makeProvider();
    vi.stubGlobal(
      "fetch",
      mockFetch(
        200,
        makePRSearchResponse([
          { number: 10, title: "Live PR" },
          { number: 11, title: "Archived PR", isArchived: true },
        ]),
      ),
    );

    const prs = await provider.listPullRequests(TEST_ACCOUNT, ["owner"]);

    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(10);
  });

  it("skips nodes with __typename !== PullRequest", async () => {
    const provider = makeProvider();
    const response = {
      data: {
        search: {
          pageInfo: { endCursor: null, hasNextPage: false },
          nodes: [
            { __typename: "Issue", number: 3, title: "should be ignored" },
            {
              __typename: "PullRequest",
              number: 20,
              title: "real pr",
              url: "https://github.com/owner/repo/pull/20",
              createdAt: "2026-05-01T00:00:00Z",
              updatedAt: "2026-05-01T00:00:00Z",
              isDraft: false,
              reviewDecision: null,
              author: { login: "alice", url: "" },
              repository: { name: "repo", nameWithOwner: "owner/repo", isArchived: false },
              labels: { nodes: [] },
              comments: { totalCount: 0 },
              reviews: { totalCount: 0 },
              assignees: { nodes: [] },
              additions: 1,
              deletions: 0,
              changedFiles: 1,
              baseRefName: "main",
              headRefName: "branch",
            },
          ],
        },
      },
    };
    vi.stubGlobal("fetch", mockFetch(200, response));

    const prs = await provider.listPullRequests(TEST_ACCOUNT, ["owner"]);

    expect(prs).toHaveLength(1);
    expect(prs[0].number).toBe(20);
  });
});
