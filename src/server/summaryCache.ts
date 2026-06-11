import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DATA_DIR } from "./config";

// Noisyink fork: cache the last Claude summary per repo+number+model so re-opening
// a thread doesn't re-bill an Anthropic call. "Regenerate" bypasses the cache.
const CACHE_PATH = resolve(DATA_DIR, "summaries.json");
const CACHE_TMP_PATH = resolve(DATA_DIR, "summaries.json.tmp");
const MAX_ENTRIES = 300;

interface CacheEntry {
  summary: string;
  generatedAt: string;
}

let cache: Record<string, CacheEntry> | null = null;

async function load(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CACHE_PATH, "utf8")) as Record<string, CacheEntry>;
  } catch {
    cache = {};
  }
  return cache;
}

export async function getCachedSummary(key: string): Promise<CacheEntry | null> {
  return (await load())[key] ?? null;
}

export async function setCachedSummary(key: string, summary: string): Promise<void> {
  const store = await load();
  store[key] = { summary, generatedAt: new Date().toISOString() };
  // Trim oldest entries if the store grows too large.
  const keys = Object.keys(store);
  if (keys.length > MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => (store[a].generatedAt < store[b].generatedAt ? -1 : 1));
    for (const stale of sorted.slice(0, keys.length - MAX_ENTRIES)) delete store[stale];
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CACHE_TMP_PATH, JSON.stringify(store), { mode: 0o600 });
  await rename(CACHE_TMP_PATH, CACHE_PATH);
}
