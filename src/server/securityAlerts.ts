import { restApiPaginate } from "./githubClient";
import { buildRepoSecuritySummary } from "../utils/security";
import type { RepoSecuritySummary } from "../types/github";

const CACHE_TTL_MS = 5 * 60 * 1000;

const summaryCache = new Map<string, { value: RepoSecuritySummary; expiresAt: number }>();
const inflightSummaries = new Map<string, Promise<RepoSecuritySummary>>();

interface SecurityAlertRecord {
  updated_at?: string | null;
}

async function fetchOpenAlerts(path: string): Promise<{ alerts: SecurityAlertRecord[]; unavailable: boolean }> {
  const result = await restApiPaginate<SecurityAlertRecord>(path);
  if (!result.ok) {
    return { alerts: [], unavailable: true };
  }
  return { alerts: result.data, unavailable: false };
}

export async function fetchRepoSecuritySummary(repo: string): Promise<RepoSecuritySummary> {
  const cached = summaryCache.get(repo);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const inflight = inflightSummaries.get(repo);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const [dependabot, codeScanning] = await Promise.all([
      fetchOpenAlerts(`/repos/${repo}/dependabot/alerts?state=open&per_page=100`),
      fetchOpenAlerts(`/repos/${repo}/code-scanning/alerts?state=open&per_page=100`),
    ]);
    return buildRepoSecuritySummary({
      dependabotAlerts: dependabot.alerts,
      codeScanningAlerts: codeScanning.alerts,
      unavailable: dependabot.unavailable || codeScanning.unavailable,
    });
  })().finally(() => {
    inflightSummaries.delete(repo);
  });

  inflightSummaries.set(repo, promise);
  const value = await promise;
  summaryCache.set(repo, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}
