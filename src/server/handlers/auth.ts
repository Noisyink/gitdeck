import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http";
import {
  authStatus,
  isClientIdConfigured,
  logout,
  pollDeviceFlow,
  startDeviceFlow,
} from "../oauth";
import { getAuthMode } from "../authProvider";
import { invalidateDataCache } from "../dashboardData";
import { invalidateCIHealthCache } from "../ciHealth";

export async function handleAuthStatus(res: ServerResponse): Promise<void> {
  const status = await authStatus();
  sendJson(res, 200, {
    ok: true,
    ...status,
    clientIdConfigured: isClientIdConfigured(),
  });
}

export async function handleAuthStart(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  if (getAuthMode() !== "device") {
    return sendJson(res, 400, {
      ok: false,
      error: `Device flow is disabled in '${getAuthMode()}' auth mode.`,
    });
  }
  if (!isClientIdConfigured()) {
    return sendJson(res, 400, {
      ok: false,
      error: "GITHUB_CLIENT_ID is not set. See README to register an OAuth App.",
    });
  }
  try {
    const flow = await startDeviceFlow();
    sendJson(res, 200, { ok: true, ...flow });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error).message });
  }
}

export async function handleAuthPoll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  if (getAuthMode() !== "device") {
    return sendJson(res, 400, {
      ok: false,
      error: `Device flow is disabled in '${getAuthMode()}' auth mode.`,
    });
  }
  try {
    const result = await pollDeviceFlow();
    if (result.status === "ok") invalidateDataCache();
    sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: (error as Error).message });
  }
}

export async function handleAuthLogout(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  if (getAuthMode() !== "device") {
    return sendJson(res, 400, {
      ok: false,
      error: `Logout is not available in '${getAuthMode()}' auth mode. Sign out via your gh CLI or unset the env token.`,
    });
  }
  await logout();
  invalidateDataCache();
  invalidateCIHealthCache();
  sendJson(res, 200, { ok: true });
}
