import { getProviderConfig } from "../accountStore";
import { GitHubProvider } from "./github";
import type { Account, Provider } from "./types";

const cache = new Map<string, Provider>();

export async function getProvider(providerConfigId: string): Promise<Provider> {
  const cached = cache.get(providerConfigId);
  if (cached) return cached;
  const config = await getProviderConfig(providerConfigId);
  if (!config) throw new Error(`Unknown provider config: ${providerConfigId}`);
  const provider = new GitHubProvider(config);
  cache.set(providerConfigId, provider);
  return provider;
}

export async function getProviderForAccount(account: Account): Promise<Provider> {
  return getProvider(account.providerConfigId);
}

export function resetProviderCache(): void {
  cache.clear();
}
