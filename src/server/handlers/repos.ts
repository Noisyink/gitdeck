import type { ServerResponse } from "node:http";
import { sendJson } from "../http";
import { gql, ghApiJson, restApiPaginate } from "../githubClient";
import { getLatestRepoDigest } from "../digests";
import { fetchRepoSecuritySummary } from "../securityAlerts";
import { requireRepo } from "./shared";

const STARGAZERS_QUERY = `
query($owner:String!, $name:String!, $cursor:String, $direction:OrderDirection!) {
  repository(owner:$owner, name:$name) {
    stargazers(first:100, after:$cursor, orderBy:{field:STARRED_AT, direction:$direction}) {
      totalCount
      pageInfo { endCursor hasNextPage }
      edges { starredAt node { login avatarUrl url } }
    }
  }
}`;

const FORKS_QUERY = `
query($owner:String!, $name:String!, $cursor:String, $field:RepositoryOrderField!, $direction:OrderDirection!) {
  repository(owner:$owner, name:$name) {
    forks(first:100, after:$cursor, orderBy:{field:$field, direction:$direction}) {
      totalCount
      pageInfo { endCursor hasNextPage }
      nodes {
        nameWithOwner
        owner { login avatarUrl }
        stargazerCount
        forkCount
        pushedAt
        updatedAt
        createdAt
        url
        description
        primaryLanguage { name }
      }
    }
  }
}`;

const ALLOWED_DIRECTIONS = new Set(["DESC", "ASC"]);
const ALLOWED_FORK_FIELDS = new Set([
  "PUSHED_AT", "UPDATED_AT", "CREATED_AT", "STARGAZERS", "NAME",
]);

export async function handleStargazers(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const direction = (u.searchParams.get("direction") || "DESC").toUpperCase();
  if (!ALLOWED_DIRECTIONS.has(direction)) return sendJson(res, 400, { ok: false, error: "invalid direction" });
  const cursor = u.searchParams.get("cursor") || null;
  try {
    const data = await gql<{
      repository: {
        stargazers: {
          totalCount: number;
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          edges: { starredAt: string; node: { login: string; avatarUrl: string; url: string } }[];
        };
      };
    }>(STARGAZERS_QUERY, { owner: rp[0], name: rp[1], cursor, direction });
    sendJson(res, 200, { ok: true, ...data.repository.stargazers });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
}

export async function handleForks(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const direction = (u.searchParams.get("direction") || "DESC").toUpperCase();
  if (!ALLOWED_DIRECTIONS.has(direction)) return sendJson(res, 400, { ok: false, error: "invalid direction" });
  const field = (u.searchParams.get("field") || "PUSHED_AT").toUpperCase();
  if (!ALLOWED_FORK_FIELDS.has(field)) return sendJson(res, 400, { ok: false, error: "invalid field" });
  const cursor = u.searchParams.get("cursor") || null;
  try {
    const data = await gql<{
      repository: {
        forks: {
          totalCount: number;
          pageInfo: { endCursor: string | null; hasNextPage: boolean };
          nodes: {
            nameWithOwner: string;
            owner: { login: string; avatarUrl: string };
            stargazerCount: number;
            forkCount: number;
            pushedAt: string;
            updatedAt: string;
            createdAt: string;
            url: string;
            description: string | null;
            primaryLanguage: { name: string } | null;
          }[];
        };
      };
    }>(FORKS_QUERY, { owner: rp[0], name: rp[1], cursor, direction, field });
    sendJson(res, 200, { ok: true, ...data.repository.forks });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
}

export async function handleRepoDetails(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const repo = `${rp[0]}/${rp[1]}`;

  async function fetchContributors() {
    return restApiPaginate(`/repos/${repo}/contributors?per_page=100&anon=1`);
  }

  async function fetchReleases() {
    return restApiPaginate(`/repos/${repo}/releases?per_page=100`);
  }

  const [meta, languages, contributors, commits, workflows, views, releases, repoDigest, security] = await Promise.all([
    ghApiJson(`/repos/${repo}`),
    ghApiJson(`/repos/${repo}/languages`),
    fetchContributors(),
    ghApiJson(`/repos/${repo}/commits?per_page=20`),
    ghApiJson(`/repos/${repo}/actions/runs?per_page=100`),
    ghApiJson(`/repos/${repo}/traffic/views`),
    fetchReleases(),
    getLatestRepoDigest(repo),
    fetchRepoSecuritySummary(repo),
  ]);

  const normalizedReleases = releases.ok
    ? ((releases.data as Array<{
        id: number;
        name: string | null;
        tag_name: string;
        html_url: string;
        draft: boolean;
        prerelease: boolean;
        published_at: string | null;
        created_at?: string | null;
        assets?: Array<{
          id: number;
          name: string;
          download_count: number;
          size?: number;
          browser_download_url?: string;
        }>;
      }> | null) ?? []).map((release) => {
        const assets = release.assets ?? [];
        return {
          ...release,
          assets,
          totalDownloads: assets.reduce((sum, asset) => sum + (asset.download_count || 0), 0),
        };
      })
    : [];

  sendJson(res, 200, {
    ok: true,
    meta: meta.ok ? meta.data : null,
    languages: languages.ok ? languages.data : {},
    contributors: contributors.ok ? contributors.data : [],
    views: views.ok ? views.data : null,
    releases: normalizedReleases,
    security,
    digest: repoDigest,
    commits: commits.ok ? commits.data : [],
    workflows: workflows.ok
      ? ((workflows.data as { workflow_runs?: unknown[] } | null)?.workflow_runs ?? [])
      : [],
    errors: {
      meta: meta.ok ? null : meta.error,
      languages: languages.ok ? null : languages.error,
      contributors: contributors.ok ? null : contributors.error,
      views: views.ok ? null : views.error,
      releases: releases.ok ? null : releases.error,
      commits: commits.ok ? null : commits.error,
      workflows: workflows.ok ? null : workflows.error,
    },
  });
}
