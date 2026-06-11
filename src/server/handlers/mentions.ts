import type { IncomingMessage, ServerResponse } from "node:http";
import { nameWithOwnerFromApiUrl } from "../../utils/repository";
import { buildMentionQuery, isValidRepoName } from "../../utils/aliasQuery";
import { addAlias, getAliases, removeAlias } from "../aliasStore";
import { sendJson } from "../http";
import { getToken, ghApiJson, restApi } from "../githubClient";
import { readBody, requireRepo } from "./shared";

interface RestIssueSearchItem {
  number: number;
  title: string;
  html_url: string;
  state: string;
  pull_request?: unknown;
  user?: { login: string; html_url: string };
  repository_url: string;
  created_at: string;
  updated_at: string;
}

interface RestCodeSearchItem {
  path: string;
  html_url: string;
  repository: { full_name: string };
}

interface DependentItem {
  owner: string;
  repo: string;
  nameWithOwner: string;
  url: string;
  stars: number;
  forks: number;
  avatar: string;
}

export async function handleMentionIssues(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const repo = `${rp[0]}/${rp[1]}`;
  const aliases = await getAliases(repo);
  const selfNames = new Set([repo, ...aliases]);
  const query = buildMentionQuery(repo, aliases);
  const path = `/search/issues?q=${encodeURIComponent(query)}&per_page=100`;
  const result = await restApi<{ items: RestIssueSearchItem[] }>(path);
  if (!result.ok) {
    if (result.status === 401) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
    return sendJson(res, 500, { ok: false, error: result.error });
  }
  const items = (result.data.items ?? [])
    .map((entry) => ({
      repository: { nameWithOwner: nameWithOwnerFromApiUrl(entry.repository_url) },
      title: entry.title,
      url: entry.html_url,
      number: entry.number,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
      state: entry.state,
      isPullRequest: Boolean(entry.pull_request),
      author: entry.user ? { login: entry.user.login, url: entry.user.html_url } : undefined,
    }))
    .filter((entry) => !selfNames.has(entry.repository.nameWithOwner));
  sendJson(res, 200, { ok: true, items, totalCount: items.length, aliases });
}

export async function handleMentionCode(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const repo = `${rp[0]}/${rp[1]}`;
  const aliases = await getAliases(repo);
  const selfNames = new Set([repo, ...aliases]);
  const query = buildMentionQuery(repo, aliases);
  const path = `/search/code?q=${encodeURIComponent(query)}&per_page=100`;
  const result = await restApi<{ items: RestCodeSearchItem[] }>(path);
  if (!result.ok) {
    if (result.status === 401) return sendJson(res, 401, { ok: false, error: "authentication required", needsAuth: true });
    return sendJson(res, 500, { ok: false, error: result.error });
  }
  const items = (result.data.items ?? [])
    .map((entry) => ({
      repository: { nameWithOwner: entry.repository.full_name },
      path: entry.path,
      url: entry.html_url,
    }))
    .filter((entry) => !selfNames.has(entry.repository.nameWithOwner));
  sendJson(res, 200, { ok: true, items, totalCount: items.length, aliases });
}

export async function handleRepoAliases(req: IncomingMessage, res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const repo = `${rp[0]}/${rp[1]}`;

  if (req.method === "GET") {
    const aliases = await getAliases(repo);
    return sendJson(res, 200, { ok: true, aliases });
  }

  if (req.method === "POST") {
    const parsed = await readBody<{ alias?: string }>(req, res);
    if (parsed === null) return;
    const alias = (parsed.alias || "").trim();
    if (!isValidRepoName(alias)) return sendJson(res, 400, { ok: false, error: "alias must be in 'owner/repo' format" });
    if (alias === repo) return sendJson(res, 400, { ok: false, error: "alias cannot equal the repository name" });
    const aliases = await addAlias(repo, alias);
    return sendJson(res, 200, { ok: true, aliases });
  }

  if (req.method === "DELETE") {
    const alias = (u.searchParams.get("alias") || "").trim();
    if (!alias) return sendJson(res, 400, { ok: false, error: "missing alias" });
    const aliases = await removeAlias(repo, alias);
    return sendJson(res, 200, { ok: true, aliases });
  }

  sendJson(res, 405, { ok: false, error: "method not allowed" });
}

export async function handleReferrers(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const repo = `${rp[0]}/${rp[1]}`;
  const [refs, paths, views, clones] = await Promise.all([
    ghApiJson(`/repos/${repo}/traffic/popular/referrers`),
    ghApiJson(`/repos/${repo}/traffic/popular/paths`),
    ghApiJson(`/repos/${repo}/traffic/views`),
    ghApiJson(`/repos/${repo}/traffic/clones`),
  ]);
  // Access denied / not owner: all four typically fail with 403. Report it as a structured reason.
  const anyForbidden = [refs, paths, views, clones].some(
    (r) => !r.ok && (r.status === 403 || /403|forbidden/i.test(r.error))
  );
  sendJson(res, 200, {
    ok: true,
    forbidden: anyForbidden,
    referrers: refs.ok ? refs.data : [],
    paths: paths.ok ? paths.data : [],
    views: views.ok ? views.data : null,
    clones: clones.ok ? clones.data : null,
  });
}

export function parseDependentsHtml(html: string): {
  items: DependentItem[];
  totalRepos: number;
  totalPackages: number;
  hasNextPage: boolean;
  nextCursor: string | null;
  hasPrevPage: boolean;
  prevCursor: string | null;
  notAvailable: boolean;
} {
  const notAvailable =
    /We haven(?:'|&#39;)t found any dependents for this repository yet/i.test(html) ||
    /This repository is not used by any other repository/i.test(html);

  const repoCountMatch = /([\d,]+)\s+Repositor(?:y|ies)/.exec(html);
  const pkgCountMatch = /([\d,]+)\s+Packages?/.exec(html);
  const totalRepos = repoCountMatch ? Number(repoCountMatch[1].replace(/,/g, "")) : 0;
  const totalPackages = pkgCountMatch ? Number(pkgCountMatch[1].replace(/,/g, "")) : 0;

  const items: DependentItem[] = [];
  const seen = new Set<string>();
  const rowMarker = '<div class="Box-row d-flex flex-items-center"';
  const pagMarker = 'class="paginate-container"';
  const parts = html.split(rowMarker);
  for (let i = 1; i < parts.length; i++) {
    let chunk = parts[i];
    const pagIdx = chunk.indexOf(pagMarker);
    if (pagIdx >= 0) chunk = chunk.substring(0, pagIdx);

    const repoLinkMatch = /data-hovercard-type="repository"[^>]*href="\/([^"\/]+)\/([^"?#]+)"/.exec(chunk);
    if (!repoLinkMatch) continue;
    const owner = repoLinkMatch[1];
    const repoName = repoLinkMatch[2];
    const nwo = `${owner}/${repoName}`;
    if (seen.has(nwo)) continue;
    seen.add(nwo);

    const starsMatch = /octicon-star[\s\S]{0,2000}?<\/svg>\s*([\d,]+)/.exec(chunk);
    const forksMatch = /octicon-repo-forked[\s\S]{0,2000}?<\/svg>\s*([\d,]+)/.exec(chunk);
    const avatarMatch =
      /<img[^>]*class="[^"]*avatar[^"]*"[^>]*src="([^"]+)"/.exec(chunk) ||
      /<img[^>]*src="([^"]+)"[^>]*class="[^"]*avatar/.exec(chunk);

    items.push({
      owner,
      repo: repoName,
      nameWithOwner: nwo,
      url: `https://github.com/${nwo}`,
      stars: starsMatch ? Number(starsMatch[1].replace(/,/g, "")) : 0,
      forks: forksMatch ? Number(forksMatch[1].replace(/,/g, "")) : 0,
      avatar: avatarMatch ? avatarMatch[1].replace(/&amp;/g, "&") : "",
    });
  }

  // Pagination: hrefs encode `&` as `&amp;`, so just match the cursor token
  const nextMatch = /href="[^"]*dependents_after=([^"&]+)[^"]*"[^>]*>\s*Next\s*<\/a>/.exec(html);
  const prevMatch = /href="[^"]*dependents_before=([^"&]+)[^"]*"[^>]*>\s*Previous\s*<\/a>/.exec(html);

  return {
    items,
    totalRepos,
    totalPackages,
    hasNextPage: !!nextMatch,
    nextCursor: nextMatch ? nextMatch[1] : null,
    hasPrevPage: !!prevMatch,
    prevCursor: prevMatch ? prevMatch[1] : null,
    notAvailable,
  };
}

export async function handleDependents(res: ServerResponse, u: URL): Promise<void> {
  const rp = requireRepo(u.searchParams.get("repo"), res);
  if (!rp) return;
  const repo = `${rp[0]}/${rp[1]}`;
  const type = (u.searchParams.get("type") || "REPOSITORY").toUpperCase();
  if (type !== "REPOSITORY" && type !== "PACKAGE") {
    return sendJson(res, 400, { ok: false, error: "invalid type" });
  }
  const after = u.searchParams.get("after") || "";
  const before = u.searchParams.get("before") || "";
  try {
    const params = new URLSearchParams({ dependent_type: type });
    if (after) params.set("dependents_after", after);
    if (before) params.set("dependents_before", before);
    const pageUrl = `https://github.com/${repo}/network/dependents?${params.toString()}`;
    const token = await getToken().catch(() => "");
    const resp = await fetch(pageUrl, {
      headers: {
        "User-Agent": "gitdeck/1.0 (+local)",
        "Accept": "text/html",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      },
      redirect: "follow",
    });
    if (resp.status === 404) {
      return sendJson(res, 200, {
        ok: true, items: [], totalRepos: 0, totalPackages: 0,
        hasNextPage: false, nextCursor: null, hasPrevPage: false, prevCursor: null,
        notAvailable: true,
      });
    }
    if (!resp.ok) return sendJson(res, 502, { ok: false, error: `GitHub returned HTTP ${resp.status}` });
    const html = await resp.text();
    const parsed = parseDependentsHtml(html);
    sendJson(res, 200, { ok: true, type, ...parsed });
  } catch (e: unknown) {
    sendJson(res, 500, { ok: false, error: (e as Error).message || String(e) });
  }
}
