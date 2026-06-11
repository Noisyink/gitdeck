import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson, sendJsonCacheable } from "../http";
import { getNotificationsCached, markAllRead, markThreadRead } from "../notifications";
import { readBody } from "./shared";
import { parseRepositoryName } from "../../utils/repository";

export async function handleNotifications(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  if (req.method && req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "GET required" });
  }
  const fresh = u.searchParams.get("fresh") === "1";
  const result = await getNotificationsCached(fresh);
  if (!result.ok) {
    const status = result.needsAuth ? 401 : 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  const participating = u.searchParams.get("participating") === "1";
  const onlyUnread = u.searchParams.get("unread") === "1";
  const reasonFilter = (u.searchParams.get("reason") || "").trim();
  let notifications = result.data.notifications;
  if (participating) {
    const participatingReasons = new Set([
      "assign", "author", "comment", "manual", "mention", "review_requested", "team_mention",
    ]);
    notifications = notifications.filter((entry) => participatingReasons.has(entry.reason));
  }
  if (onlyUnread) notifications = notifications.filter((entry) => entry.unread);
  if (reasonFilter) {
    const allowed = new Set(reasonFilter.split(",").map((value) => value.trim()).filter(Boolean));
    if (allowed.size) notifications = notifications.filter((entry) => allowed.has(entry.reason));
  }
  sendJsonCacheable(req, res, 200, {
    ok: true,
    notifications,
    fetchedAt: result.data.fetchedAt,
    pollInterval: result.data.pollInterval,
  });
}

export async function handleNotificationRead(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  const parsed = await readBody<{ threadId?: string }>(req, res);
  if (parsed === null) return;
  const threadId = (parsed.threadId || "").trim();
  if (!threadId || !/^\d+$/.test(threadId)) {
    return sendJson(res, 400, { ok: false, error: "missing or invalid threadId" });
  }
  const result = await markThreadRead(threadId);
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(res, 200, { ok: true });
}

export async function handleNotificationsReadAll(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  const parsed = await readBody<{ repo?: string; lastReadAt?: string }>(req, res);
  if (parsed === null) return;
  const repo = (parsed.repo || "").trim() || null;
  if (repo && !parseRepositoryName(repo)) return sendJson(res, 400, { ok: false, error: "invalid repo" });
  const lastReadAt = parsed.lastReadAt ? String(parsed.lastReadAt) : null;
  if (lastReadAt && Number.isNaN(Date.parse(lastReadAt))) {
    return sendJson(res, 400, { ok: false, error: "invalid lastReadAt" });
  }
  const result = await markAllRead({ repo, lastReadAt });
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(res, 200, { ok: true });
}
