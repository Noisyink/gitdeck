# Gitdeck fork — backlog

Personal-fork backlog for `Noisyink/gitdeck`. Captured 2026-06-11. Nothing here is
blocking; the dashboard is fully working on the home server at `:8766`.

## Your action (not code)
- [ ] Mint an Anthropic API key (console.anthropic.com) and enter it in
      Preferences → Claude to enable thread summaries. Pay-per-token (~0.5c/Haiku
      summary); a Pro/Max subscription cannot back it.

## Cleanup / hygiene
- [ ] Fix the 4 pre-existing **upstream** `tsc --noEmit` errors so `npm run typecheck`
      is clean: `TriageWorkspace.tsx:82`, `server/digests.ts:48`,
      `server/openaiDigest.ts:27`, `tests/utils/colors.test.ts`. None are from our
      patches; the build (esbuild/vite) doesn't gate on them.
- [ ] Check whether debba's `.github/workflows` CI runs on the fork and failing
      noisily; disable/remove the inherited workflows if so (needs a
      `workflow`-scoped token to push the change).
- [ ] Hide or remove the **Notifications tab** — it always 403s without a
      `notifications`-scoped token (fine-grained PATs can't use that API at all).
- [ ] UI to **clear/rotate** the Anthropic key and re-onboard the GitHub token
      (settings are currently set-only; clearing = wipe the `gitdeck-data` volume).

## Features / polish
- [ ] Surface the owned/non-owned/both **default** as a preference (deferred — the
      live toggle already sits in the repos toolbar).
- [ ] **Cache the last summary** per thread (in the data volume) so re-opening a
      thread doesn't re-bill an Anthropic call on every Summarize click.
- [ ] **"Load more"** for long timelines — `fetchThread` caps at 100 events;
      "Open in GitHub" is the current escape hatch for very long threads.
- [ ] Broaden thread timeline coverage (more event types; inline review-comment
      threads), currently a curated set + top-level comments/reviews.

## The big one
- [ ] Progressive **hand rewrite** to de-AI-slop the upstream scaffolding (the fork
      notice in README flags this as the long-term direction). Do it in slices, not
      a big-bang; keep `upstream-mirror` as the diff baseline.

## New server / migration (cross-ref `../migration/TODO.md` in the home-server repo)
- [ ] On the new platform, fold gitdeck into the **services-guest** stack behind
      **Caddy** (and likely **Authentik**) instead of exposing raw `:8766`.
- [ ] Move both secrets — the write-capable **GitHub token** and the **Anthropic
      key** — out of `.env` / `settings.json` on the volume into the **SOPS/OpenBao**
      pattern the rest of the stack uses.

## Security posture note
This is a **no-login LAN app** that holds a write-capable GitHub token + an
Anthropic key and performs **public writes** (comments). Acceptable on the trusted
LAN today; on the new platform it must sit behind Caddy/Authentik before any wider
exposure.
