import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA_DIR } from "./config";

// Noisyink fork: server-side settings entered via the preferences UI and persisted
// to the data volume (0600). Holds the Anthropic API key for thread summaries, the
// default summary model, an enable flag, and the contribution-filter qualifier.
const SETTINGS_PATH = resolve(DATA_DIR, "settings.json");
const SETTINGS_TMP_PATH = resolve(DATA_DIR, "settings.json.tmp");

export const SUMMARY_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"] as const;
export type SummaryModel = (typeof SUMMARY_MODELS)[number];

export function isSummaryModel(value: unknown): value is SummaryModel {
  return typeof value === "string" && (SUMMARY_MODELS as readonly string[]).includes(value);
}

export interface Settings {
  anthropicApiKey: string;
  summaryModel: SummaryModel;
  summaryEnabled: boolean;
  contribFilter: string;
}

export interface PublicSettings {
  summaryModel: SummaryModel;
  summaryEnabled: boolean;
  contribFilter: string;
  anthropicConfigured: boolean;
}

const DEFAULTS: Settings = {
  anthropicApiKey: "",
  summaryModel: "claude-haiku-4-5",
  summaryEnabled: false,
  contribFilter: "",
};

let cache: Settings | null = null;

async function load(): Promise<Settings> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(SETTINGS_PATH, "utf8")) as Partial<Settings>;
    cache = {
      anthropicApiKey: typeof parsed.anthropicApiKey === "string" ? parsed.anthropicApiKey : "",
      summaryModel: isSummaryModel(parsed.summaryModel) ? parsed.summaryModel : DEFAULTS.summaryModel,
      summaryEnabled: Boolean(parsed.summaryEnabled),
      contribFilter: typeof parsed.contribFilter === "string" ? parsed.contribFilter : "",
    };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

export async function getSettings(): Promise<Settings> {
  return { ...(await load()) };
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const settings = await load();
  return {
    summaryModel: settings.summaryModel,
    summaryEnabled: settings.summaryEnabled,
    contribFilter: settings.contribFilter,
    anthropicConfigured: Boolean(settings.anthropicApiKey),
  };
}

// Resolve the Issues/PRs search qualifier: UI setting, then env, then default.
export async function getContribFilter(): Promise<string> {
  const settings = await load();
  return settings.contribFilter || process.env.GH_DASH_FILTER?.trim() || "author:@me";
}

export async function updateSettings(patch: Partial<Settings> & { clearAnthropicKey?: boolean }): Promise<PublicSettings> {
  const next: Settings = { ...(await load()) };
  // Explicit clear (rotation/removal), else only overwrite when a non-empty value
  // is supplied (so a normal save doesn't wipe the stored key).
  if (patch.clearAnthropicKey === true) next.anthropicApiKey = "";
  else if (typeof patch.anthropicApiKey === "string" && patch.anthropicApiKey.trim()) next.anthropicApiKey = patch.anthropicApiKey.trim();
  if (isSummaryModel(patch.summaryModel)) next.summaryModel = patch.summaryModel;
  if (typeof patch.summaryEnabled === "boolean") next.summaryEnabled = patch.summaryEnabled;
  if (typeof patch.contribFilter === "string") next.contribFilter = patch.contribFilter.trim();
  cache = next;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SETTINGS_TMP_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  await rename(SETTINGS_TMP_PATH, SETTINGS_PATH);
  return getPublicSettings();
}
