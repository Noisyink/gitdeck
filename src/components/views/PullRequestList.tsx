import type { GhPullRequest } from "../../types/github";
import { useState } from "react";
import { reviewDecisionLabel } from "../../utils/dashboard";
import { formatNumber, formatRelativeTime } from "../../utils/format";
import { getLabelCssVars } from "../../utils/colors";
import { Avatar } from "../common/Avatar";
import { PulseIcon } from "../common/Icons";
import { IssueThread } from "../common/IssueThread";
import { useI18n } from "../../i18n/I18nProvider";

function reviewBadgeClass(pr: GhPullRequest): string {
  if (pr.reviewDecision === "APPROVED") return "approved";
  if (pr.reviewDecision === "CHANGES_REQUESTED") return "changes";
  return "pending";
}

// Noisyink fork: clicking the row expands an inline thread instead of opening
// GitHub; "Open in GitHub" moves to a surface button next to Reply.
function PullRequestRow({ pr }: { pr: GhPullRequest }) {
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const stale = Date.now() - new Date(pr.updatedAt).getTime() > 14 * 86_400_000;
  const author = pr.author?.login || "unknown";
  return (
    <div className={expanded ? "data-row-wrap expanded" : "data-row-wrap"}>
      <div
        className="data-row clickable"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpanded((value) => !value); } }}
      >
        <Avatar login={pr.author?.login} size={36} />
        <div className="data-row-body">
          <div className="data-row-top">
            <strong className="data-row-author">{author}</strong>
            <span className="data-row-repo">{pr.repository.nameWithOwner}</span>
            <span className="data-row-num">#{pr.number}</span>
            <em>{formatRelativeTime(pr.updatedAt, Date.now(), language)}</em>
          </div>
          <div className="data-row-title">{pr.title}</div>
          <div className="data-row-meta">
            <span className="data-kind pull-request"><PulseIcon /> {t("list.pr")}</span>
            {pr.isDraft ? <span className="pr-badge draft">{t("list.draft")}</span> : null}
            <span className={`pr-badge review ${reviewBadgeClass(pr)}`}>{reviewDecisionLabel(pr.reviewDecision)}</span>
            {stale ? <span className="stale-badge">{t("list.stale")}</span> : null}
            {(pr.labels || []).slice(0, 3).map((label) => {
              const vars = getLabelCssVars(label.color ?? "");
              return (
                <span className={vars ? "data-label gh-label" : "data-label"} key={label.name} style={vars}>
                  {label.name}
                </span>
              );
            })}
            <span className="data-row-spacer" />
            <span className="pr-diff">
              <span className="pr-diff-add">+{formatNumber(pr.additions)}</span>
              <span className="pr-diff-del">−{formatNumber(pr.deletions)}</span>
            </span>
            <span className="data-row-count">{t("list.comments", { count: pr.commentsCount })}</span>
            {pr.assignees && pr.assignees.length ? (
              <span className="data-row-assignees">
                {pr.assignees.slice(0, 3).map((assignee) => (
                  <Avatar key={assignee.login} login={assignee.login} size={18} />
                ))}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="row-actions">
        <button type="button" className="reply-toggle" onClick={() => setExpanded(true)}>{t("reply.button")}</button>
        <a className="row-open" href={pr.url} target="_blank" rel="noreferrer">{t("thread.openGithub")}</a>
      </div>
      {expanded ? <IssueThread repo={pr.repository.nameWithOwner} number={pr.number} /> : null}
    </div>
  );
}

export function PullRequestList({ pullRequests }: { pullRequests: GhPullRequest[] }) {
  const { t } = useI18n();
  if (!pullRequests.length) {
    return <div className="empty"><div className="big">{t("empty.prsTitle")}</div><div>{t("empty.tryClearing")}</div></div>;
  }

  return (
    <div className="data-list">
      {pullRequests.map((pr) => <PullRequestRow pr={pr} key={pr.url} />)}
    </div>
  );
}
