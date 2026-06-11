import type { ThreadData } from "./providers/types";
import { getSettings, isSummaryModel, type SummaryModel } from "./settingsStore";

// Noisyink fork: summarise a PR/issue thread via the Anthropic API. Raw fetch to
// /v1/messages (no SDK), mirroring openaiDigest.ts and this backend's no-extra-dep
// design. Key + default model come from the settings store; bills the user's key.
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

type ThreadOk = Extract<ThreadData, { ok: true }>;

export type SummaryOutcome =
  | { ok: true; summary: string; model: string }
  | { ok: false; status: number; error: string; needsKey?: true };

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

// F-01: extract only the structured Anthropic error message; never proxy the raw body.
async function safeError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: { message?: string }; message?: string };
    return data.error?.message || data.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function buildPrompt(thread: ThreadOk, repo: string, issueNumber: number): string {
  const kind = thread.item.isPullRequest ? "pull request" : "issue";
  const lines: string[] = [
    `${kind} ${repo} #${issueNumber}: ${thread.item.title}`,
    `State: ${thread.item.state}`,
    `Opened by ${thread.item.author?.login ?? "unknown"}:`,
    stripHtml(thread.item.bodyHtml).slice(0, 4000),
    "",
    "Thread:",
  ];
  for (const entry of thread.entries) {
    if (entry.kind === "comment") lines.push(`- ${entry.actor?.login ?? "someone"} commented: ${stripHtml(entry.bodyHtml).slice(0, 1500)}`);
    else if (entry.kind === "review") lines.push(`- ${entry.actor?.login ?? "someone"} reviewed (${entry.state}): ${stripHtml(entry.bodyHtml).slice(0, 1500)}`);
    else if (entry.kind === "review-comment") lines.push(`- ${entry.actor?.login ?? "someone"} commented on ${entry.path}: ${stripHtml(entry.bodyHtml).slice(0, 1500)}`);
    else lines.push(`- ${entry.actor?.login ?? "someone"} ${entry.eventType}${entry.detail ? ` ${entry.detail}` : ""}`);
  }
  return lines.join("\n").slice(0, 24000);
}

export async function summariseThread(thread: ThreadOk, repo: string, issueNumber: number, requestedModel?: string): Promise<SummaryOutcome> {
  const settings = await getSettings();
  if (!settings.anthropicApiKey) return { ok: false, status: 400, error: "no Anthropic API key configured", needsKey: true };
  if (!settings.summaryEnabled) return { ok: false, status: 400, error: "summaries are disabled" };
  const model: SummaryModel = isSummaryModel(requestedModel) ? requestedModel : settings.summaryModel;
  const kind = thread.item.isPullRequest ? "pull request" : "issue";
  const system = `You summarise a GitHub ${kind} thread for a busy maintainer. In 3 to 5 sentences, cover what it is about, the current state, and what is blocking it or what the next step is. Be concrete and neutral. Do not use markdown headings or bullet points.`;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropicApiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system,
        messages: [{ role: "user", content: buildPrompt(thread, repo, issueNumber) }],
      }),
      // F-02: native http has no per-request timeout; don't hold the handler open.
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      // F-01: surface only the structured error message, never the raw body.
      return { ok: false, status: response.status, error: await safeError(response) };
    }
    const data = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    const summary = (data.content || []).filter((block) => block.type === "text" && block.text).map((block) => block.text).join("\n").trim();
    if (!summary) return { ok: false, status: 502, error: "empty summary from Anthropic" };
    return { ok: true, summary, model };
  } catch (error) {
    if ((error as Error)?.name === "TimeoutError") return { ok: false, status: 408, error: "Anthropic request timed out" };
    return { ok: false, status: 500, error: (error as Error).message || String(error) };
  }
}
