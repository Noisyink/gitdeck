import { restApiPaginate } from "./githubClient";
import { buildRepoSecuritySummary } from "../utils/security";
import type { RepoSecuritySummary } from "../types/github";

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
  const [dependabot, codeScanning] = await Promise.all([
    fetchOpenAlerts(`/repos/${repo}/dependabot/alerts?state=open&per_page=100`),
    fetchOpenAlerts(`/repos/${repo}/code-scanning/alerts?state=open&per_page=100`),
  ]);

  return buildRepoSecuritySummary({
    dependabotAlerts: dependabot.alerts,
    codeScanningAlerts: codeScanning.alerts,
    unavailable: dependabot.unavailable || codeScanning.unavailable,
  });
}
