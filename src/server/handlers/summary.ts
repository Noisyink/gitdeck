import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "../http";
import { getActive as getActiveAccount } from "../accountStore";
import { getProviderForAccount } from "../providers/registry";
import { getPublicSettings, isSummaryModel } from "../settingsStore";
import { summariseThread } from "../anthropicSummary";
import { getCachedSummary, setCachedSummary } from "../summaryCache";
import { readBody, requireRepo } from "./shared";

// Noisyink fork: summarise a PR/issue thread via the Anthropic API, with a
// per-(repo,number,model) cache so re-opening a thread doesn't re-bill. `fresh`
// bypasses the cache (the Regenerate button).
export async function handleSummary(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "POST required" });
  const parsed = await readBody<{ repo?: string; number?: number; model?: string; fresh?: boolean }>(req, res);
  if (parsed === null) return;
  const repoPair = requireRepo(parsed.repo, res);
  const number = Number(parsed.number);
  if (!repoPair) return;
  if (!Number.isInteger(number) || number <= 0) return sendJson(res, 400, { ok: false, error: "missing or invalid number" });
  const settings = await getPublicSettings();
  if (!settings.anthropicConfigured) return sendJson(res, 400, { ok: false, error: "no Anthropic API key configured", needsKey: true });
  if (!settings.summaryEnabled) return sendJson(res, 400, { ok: false, error: "summaries are disabled" });
  const repo = `${repoPair[0]}/${repoPair[1]}`;
  const model = isSummaryModel(parsed.model) ? parsed.model : settings.summaryModel;
  const cacheKey = `${repo}#${number}#${model}`;
  if (parsed.fresh !== true) {
    const cached = await getCachedSummary(cacheKey);
    if (cached) return sendJson(res, 200, { ok: true, summary: cached.summary, model, cached: true });
  }
  const account = await getActiveAccount();
  if (!account) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
  const provider = await getProviderForAccount(account);
  const thread = await provider.fetchThread(account, repo, number);
  if (!thread.ok) {
    const status = thread.needsAuth ? 401 : thread.status || 500;
    return sendJson(res, status, { ok: false, error: thread.error, needsAuth: thread.needsAuth });
  }
  const result = await summariseThread(thread, repo, number, model);
  if (!result.ok) {
    return sendJson(res, result.status || 500, { ok: false, error: result.error, needsKey: result.needsKey });
  }
  await setCachedSummary(cacheKey, result.summary);
  sendJson(res, 200, { ok: true, summary: result.summary, model: result.model, cached: false });
}
