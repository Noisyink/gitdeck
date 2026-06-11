export type ProviderKind = "github" | "forgejo";

export type AccountSource = "device" | "gh-cli" | "token" | "env";

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  webUrl: string;
  graphqlUrl?: string;
  oauthAuthorizeUrl?: string;
  oauthDeviceCodeUrl?: string;
  oauthTokenUrl?: string;
  oauthClientId?: string;
  oauthScopes?: string;
  userAgent: string;
}

export interface ProviderCapabilities {
  graphql: boolean;
  notifications: boolean;
  projects: boolean;
  ciWorkflows: boolean;
  codeSearch: boolean;
  dependents: boolean;
  traffic: boolean;
  stargazerHistory: boolean;
}

export interface Account {
  id: string;
  providerKind: ProviderKind;
  providerConfigId: string;
  label: string;
  login: string | null;
  accessToken: string;
  scope: string;
  obtainedAt: string;
  source: AccountSource;
  ephemeral?: boolean;
}

export interface AccountStoreData {
  version: 1;
  activeId: string | null;
  accounts: Account[];
  providerConfigs: Record<string, ProviderConfig>;
}

export interface DeviceFlowStart {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  deviceCode: string;
}

export type DeviceFlowPoll =
  | { status: "ok"; accessToken: string; scope: string; login: string }
  | { status: "pending" }
  | { status: "throttled"; interval?: number }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; error: string };

export interface ProviderIdentity {
  login: string;
  scope: string | null;
  avatarUrl?: string | null;
  htmlUrl?: string | null;
}

export interface OwnersResult {
  ok: true;
  owners: string[];
}

export interface OwnersError {
  ok: false;
  error: string;
  needsAuth?: true;
}

export type OwnersOutcome = OwnersResult | OwnersError;

export interface NotificationsFetchOk {
  ok: true;
  refreshed: boolean;
  notifications: import("../../types/github").GhNotification[];
  pollInterval: number;
  lastModified: string | null;
}

export interface NotificationsFetchError {
  ok: false;
  error: string;
  needsAuth?: true;
}

export type NotificationsFetchOutcome = NotificationsFetchOk | NotificationsFetchError;

export interface NotificationMutationOk {
  ok: true;
  status: number;
}

export interface NotificationMutationError {
  ok: false;
  status: number;
  error: string;
  needsAuth?: true;
}

export type NotificationMutationOutcome = NotificationMutationOk | NotificationMutationError;

// Noisyink fork: result of posting a comment from the inline reply box.
export interface CommentOk {
  ok: true;
  htmlUrl: string;
}

export interface CommentError {
  ok: false;
  status: number;
  error: string;
  needsAuth?: true;
}

export type CommentOutcome = CommentOk | CommentError;

// Noisyink fork: inline thread view (issue/PR body + timeline) for a card.
export interface ThreadActor {
  login: string;
  avatarUrl: string;
  url: string;
}

export interface ThreadItem {
  author: ThreadActor | null;
  title: string;
  bodyHtml: string;
  createdAt: string;
  state: string;
  url: string;
  isPullRequest: boolean;
}

export type ThreadEntry =
  | { kind: "comment"; actor: ThreadActor | null; createdAt: string; bodyHtml: string; url: string }
  | { kind: "review"; actor: ThreadActor | null; createdAt: string; bodyHtml: string; state: string }
  | { kind: "event"; actor: ThreadActor | null; createdAt: string; eventType: string; detail: string };

export type ThreadData =
  | { ok: true; item: ThreadItem; entries: ThreadEntry[]; truncated?: boolean }
  | { ok: false; status: number; error: string; needsAuth?: true };

export interface Provider {
  readonly kind: ProviderKind;
  readonly config: ProviderConfig;
  readonly capabilities: ProviderCapabilities;

  startDeviceFlow(): Promise<DeviceFlowStart>;
  pollDeviceFlow(deviceCode: string): Promise<DeviceFlowPoll>;
  fetchIdentity(token: string): Promise<ProviderIdentity>;
  loadFromGhCli?(): Promise<{ token: string } | null>;

  listOwners(account: Account): Promise<OwnersOutcome>;
  listRepos(
    account: Account,
    owners: string[],
  ): Promise<import("../../types/github").GhRepo[]>;
  listIssues(
    account: Account,
    owners: string[],
  ): Promise<import("../../types/github").GhIssue[]>;
  listPullRequests(
    account: Account,
    owners: string[],
  ): Promise<import("../../types/github").GhPullRequest[]>;

  fetchNotifications(account: Account, ifModifiedSince: string | null): Promise<NotificationsFetchOutcome>;
  markNotificationRead(account: Account, threadId: string): Promise<NotificationMutationOutcome>;
  markAllNotificationsRead(
    account: Account,
    options: { repo?: string | null; lastReadAt?: string | null },
  ): Promise<NotificationMutationOutcome>;

  // Noisyink fork: post a comment to an issue or PR.
  createComment(account: Account, repo: string, issueNumber: number, body: string): Promise<CommentOutcome>;

  // Noisyink fork: fetch the issue/PR body + timeline for the inline thread view.
  fetchThread(account: Account, repo: string, issueNumber: number): Promise<ThreadData>;

  avatarUrl(login: string, size?: number): string;
  webUrlFor(kind: "user" | "repo" | "issue" | "pr", parts: Record<string, string | number>): string;
}
