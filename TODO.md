# Gitdeck fork — backlog

Personal-fork backlog for `Noisyink/gitdeck`. Running on the home server at `:8766`.

## Done (2026-06-11 sweep)
- [x] Fixed the 4 pre-existing upstream `tsc` errors — `npm run typecheck` and the
      test suite now pass clean.
- [x] Hid the Notifications (Inbox) nav tab — it 403s without a `notifications`
      token; the view code and `/inbox` route remain, only the button is gone.
- [x] **Summary caching** — the last Claude summary per (repo, number, model) is
      cached server-side (`summaries.json`); re-opening a thread is free, and
      "Regenerate" (`fresh`) is the only path that re-bills.
- [x] Long-timeline handling — `fetchThread` flags `truncated` at 100 events and
      the thread shows "Showing the first 100 events. Open in GitHub." (Full
      append-pagination was judged disproportionate; the Open-in-GitHub button is
      the escape hatch for very long threads.)
- [x] Ownership toggle now persists (localStorage) so your owned/non-owned/both
      choice is the default across reloads.
- [x] Clear/rotate the Anthropic key from Preferences (Clear button + server clear
      path). GitHub-token rotation is still via the existing add-token flow.

## Open
- [x] Inherited CI: debba's one `dockerbuild.yml` workflow had run 0 times on the
      fork (not failing). Disabled it via the Actions API (`disabled_manually`) with
      the `repo` token — no `workflow` scope needed. The file stays in the tree
      (deleting it would need a `workflow`-scoped token); disabled is sufficient.
- [x] Broaden thread timeline coverage — added more event types (committed,
      cross-referenced, milestoned, ready_for_review, etc.) and inline PR review
      comments (new `review-comment` kind, file path shown), sorted chronologically.
- [x] **Rewrite review** done via the Lead→Architect→Reviewer pipeline — see
      [`REWRITE-REVIEW.md`](REWRITE-REVIEW.md): per-area keep/refactor/rewrite/delete
      verdicts, slop taxonomy, an 8-slice rewrite order, fork-patch preservation map,
      and test-gap gates. Reviewer's 3 fix-now items (Anthropic error proxy + timeout,
      ReplyBox confirm snapshot) are **fixed**; the during-rewrite items (F-03/04/06-10)
      are folded into the slice plan.
- [ ] Execute the **hand rewrite** per `REWRITE-REVIEW.md` — 8 slices, deletions
      first (tokenStore → OpenAI digest → Inbox → Forgejo seam), monoliths last;
      characterization tests required before slices 5 and 6/7. Keep `upstream-mirror`
      as the diff baseline.

## New server / migration (cross-ref `../migration/TODO.md`, blocked on K8 Plus hardware)
- [ ] Fold gitdeck into the **services-guest** stack behind **Caddy** (+ likely
      **Authentik**) instead of exposing raw `:8766`.
- [ ] Move both secrets — the write-capable **GitHub token** and the **Anthropic
      key** — out of `.env` / `settings.json` into the **SOPS/OpenBao** pattern.

## Security posture note
A no-login LAN app holding a write-capable GitHub token + an Anthropic key that
performs public writes. Fine on the trusted LAN; gate behind Caddy/Authentik before
any wider exposure.
