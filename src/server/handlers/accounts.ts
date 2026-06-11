import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http";
import {
  add as addAccount,
  getActive as getActiveAccount,
  getProviderConfig,
  init as initAccountStore,
  list as listAccountsStore,
  listProviderConfigs,
  remove as removeAccountStore,
  setActive as setActiveAccount,
} from "../accountStore";
import { getProvider, getProviderForAccount } from "../providers/registry";
import { invalidateDataCache } from "../dashboardData";
import { invalidateCIHealthCache } from "../ciHealth";
import { readBody } from "./shared";

export interface AccountSummary {
  id: string;
  providerKind: string;
  providerConfigId: string;
  label: string;
  login: string | null;
  scope: string;
  source: string;
  ephemeral: boolean;
  active: boolean;
  capabilities: Record<string, boolean>;
}

export async function summariseAccount(account: Awaited<ReturnType<typeof getActiveAccount>>, activeId: string | null): Promise<AccountSummary | null> {
  if (!account) return null;
  let capabilities: Record<string, boolean> = {};
  try {
    const provider = await getProviderForAccount(account);
    capabilities = { ...provider.capabilities };
  } catch {
    // Unknown provider kind — return empty caps; UI will treat as conservative.
  }
  return {
    id: account.id,
    providerKind: account.providerKind,
    providerConfigId: account.providerConfigId,
    label: account.label,
    login: account.login,
    scope: account.scope,
    source: account.source,
    ephemeral: Boolean(account.ephemeral),
    active: account.id === activeId,
    capabilities,
  };
}

export async function handleAccountsList(res: ServerResponse): Promise<void> {
  await initAccountStore();
  const all = await listAccountsStore();
  const active = await getActiveAccount();
  const summaries: AccountSummary[] = [];
  for (const account of all) {
    const summary = await summariseAccount(account, active?.id ?? null);
    if (summary) summaries.push(summary);
  }
  sendJson(res, 200, { ok: true, accounts: summaries, activeId: active?.id ?? null });
}

export async function handleAccountActivate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  const parsed = await readBody<{ id?: string }>(req, res);
  if (parsed === null) return;
  const id = (parsed.id || "").trim();
  if (!id) return sendJson(res, 400, { ok: false, error: "missing id" });
  await initAccountStore();
  const account = await setActiveAccount(id);
  if (!account) return sendJson(res, 404, { ok: false, error: "account not found" });
  invalidateDataCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true, activeId: account.id });
}

export async function handleProviderConfigsList(res: ServerResponse): Promise<void> {
  await initAccountStore();
  const configs = await listProviderConfigs();
  const summaries = Object.values(configs).map((cfg) => ({
    id: cfg.id,
    kind: cfg.kind,
    label: cfg.label,
    webUrl: cfg.webUrl,
    supportsDeviceFlow: Boolean(cfg.oauthDeviceCodeUrl) && cfg.kind === "github",
  }));
  sendJson(res, 200, { ok: true, configs: summaries });
}

export async function handleAccountAddToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  const parsed = await readBody<{ providerConfigId?: string; token?: string; label?: string }>(req, res);
  if (parsed === null) return;
  const providerConfigId = (parsed.providerConfigId || "").trim();
  const token = (parsed.token || "").trim();
  if (!providerConfigId) return sendJson(res, 400, { ok: false, error: "missing providerConfigId" });
  if (!token) return sendJson(res, 400, { ok: false, error: "missing token" });
  await initAccountStore();
  const config = await getProviderConfig(providerConfigId);
  if (!config) return sendJson(res, 404, { ok: false, error: "unknown providerConfigId" });
  let identity;
  try {
    const provider = await getProvider(providerConfigId);
    identity = await provider.fetchIdentity(token);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: (error as Error).message });
  }
  if (!identity.login) return sendJson(res, 400, { ok: false, error: "provider did not return a login" });
  const safeLogin = identity.login.replace(/[^a-zA-Z0-9_-]/g, "_");
  const prefix = "gh";
  const webHost = new URL(config.webUrl).host;
  const account = await addAccount({
    id: `${prefix}_${safeLogin}_${providerConfigId}`,
    providerKind: config.kind,
    providerConfigId,
    label: parsed.label?.trim() || `${identity.login} (${webHost})`,
    login: identity.login,
    accessToken: token,
    scope: identity.scope ?? "",
    obtainedAt: new Date().toISOString(),
    source: "token",
  });
  invalidateDataCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true, accountId: account.id });
}

export async function handleAccountRemove(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  if (req.method !== "DELETE") return sendJson(res, 405, { ok: false, error: "DELETE required" });
  const id = (u.searchParams.get("id") || "").trim();
  if (!id) return sendJson(res, 400, { ok: false, error: "missing id" });
  await initAccountStore();
  const existed = await removeAccountStore(id);
  if (!existed) return sendJson(res, 404, { ok: false, error: "account not found" });
  invalidateDataCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true });
}
