import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http";
import { getPublicSettings, updateSettings } from "../settingsStore";
import { readBody } from "./shared";

// Noisyink fork: read/write user settings (Anthropic key, summary model/enable,
// contrib filter). GET never returns the raw key.
export async function handleSettings(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "GET") {
    return sendJson(res, 200, { ok: true, settings: await getPublicSettings() });
  }
  if (req.method === "PUT") {
    const parsed = await readBody<Record<string, unknown>>(req, res);
    if (parsed === null) return;
    const updated = await updateSettings(parsed);
    return sendJson(res, 200, { ok: true, settings: updated });
  }
  return sendJson(res, 405, { ok: false, error: "GET or PUT required" });
}
