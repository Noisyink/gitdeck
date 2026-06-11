import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http";
import { getActive as getActiveAccount } from "../accountStore";
import { getProviderForAccount } from "../providers/registry";
import { readBody, requireRepo } from "./shared";

// Noisyink fork: post a comment to an issue or PR from the inline reply box.
export async function handleCreateComment(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  const parsed = await readBody<{ repo?: string; number?: number; body?: string }>(req, res);
  if (parsed === null) return;
  const repoPair = requireRepo(parsed.repo, res);
  const number = Number(parsed.number);
  const body = (parsed.body || "").trim();
  if (!repoPair) return;
  if (!Number.isInteger(number) || number <= 0) return sendJson(res, 400, { ok: false, error: "missing or invalid number" });
  if (!body) return sendJson(res, 400, { ok: false, error: "empty comment body" });
  const account = await getActiveAccount();
  if (!account) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
  const provider = await getProviderForAccount(account);
  const result = await provider.createComment(account, `${repoPair[0]}/${repoPair[1]}`, number, body);
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(res, 200, { ok: true, htmlUrl: result.htmlUrl });
}
