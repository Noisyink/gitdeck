import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http";
import { getActive as getActiveAccount } from "../accountStore";
import { getProviderForAccount } from "../providers/registry";
import { requireRepo } from "./shared";

// Noisyink fork: issue/PR body + timeline for the inline thread view.
export async function handleThread(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  const repoPair = requireRepo(u.searchParams.get("repo"), res);
  const number = Number(u.searchParams.get("number"));
  if (!repoPair) return;
  if (!Number.isInteger(number) || number <= 0) return sendJson(res, 400, { ok: false, error: "missing or invalid number" });
  const account = await getActiveAccount();
  if (!account) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
  const provider = await getProviderForAccount(account);
  const result = await provider.fetchThread(account, `${repoPair[0]}/${repoPair[1]}`, number);
  if (!result.ok) {
    const status = result.needsAuth ? 401 : result.status || 500;
    return sendJson(res, status, { ok: false, error: result.error, needsAuth: result.needsAuth });
  }
  sendJson(res, 200, result);
}
