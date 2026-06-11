import type { IncomingMessage, ServerResponse } from "node:http";
import { parseRepositoryName } from "../../utils/repository";
import { sendJson } from "../http";

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

// Parse the request body as JSON and return it, or send 400 and
// return null so the caller can `if (parsed === null) return;`.
export async function readBody<T>(req: IncomingMessage, res: ServerResponse): Promise<T | null> {
  try {
    return (await readJsonBody(req)) as T;
  } catch {
    sendJson(res, 400, { ok: false, error: "invalid JSON" });
    return null;
  }
}

// Parse a `repo` query/body value and return the [owner,name]
// pair, or send 400 and return null so the caller can `if (!rp) return;`.
export function requireRepo(raw: string | null | undefined, res: ServerResponse): [string, string] | null {
  const rp = parseRepositoryName(raw ?? null);
  if (!rp) sendJson(res, 400, { ok: false, error: "missing or invalid repo" });
  return rp;
}
