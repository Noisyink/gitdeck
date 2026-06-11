import type { GhIssue } from "../../types/github";
import { useState } from "react";
import { formatRelativeTime } from "../../utils/format";
import { getLabelCssVars } from "../../utils/colors";
import { Avatar } from "../common/Avatar";
import { IssueIcon } from "../common/Icons";
import { IssueThread } from "../common/IssueThread";
import { useI18n } from "../../i18n/I18nProvider";

// Noisyink fork: clicking the row expands an inline thread instead of opening
// GitHub; "Open in GitHub" moves to a surface button next to Reply.
function IssueRow({ issue }: { issue: GhIssue }) {
  const { language, t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const stale = Date.now() - new Date(issue.updatedAt).getTime() > 30 * 86_400_000;
  const author = issue.author?.login || "unknown";
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
        <Avatar login={issue.author?.login} size={36} />
        <div className="data-row-body">
          <div className="data-row-top">
            <strong className="data-row-author">{author}</strong>
            <span className="data-row-repo">{issue.repository.nameWithOwner}</span>
            <span className="data-row-num">#{issue.number}</span>
            <em>{formatRelativeTime(issue.updatedAt, Date.now(), language)}</em>
          </div>
          <div className="data-row-title">{issue.title}</div>
          <div className="data-row-meta">
            <span className="data-kind issue"><IssueIcon /> {t("list.issue")}</span>
            {stale ? <span className="stale-badge">{t("list.stale")}</span> : null}
            {(issue.labels || []).slice(0, 4).map((label) => {
              const vars = getLabelCssVars(label.color ?? "");
              return (
                <span className={vars ? "data-label gh-label" : "data-label"} key={label.name} style={vars}>
                  {label.name}
                </span>
              );
            })}
            {(issue.labels || []).length > 4 ? (
              <span className="data-label muted">+{issue.labels.length - 4}</span>
            ) : null}
            <span className="data-row-spacer" />
            <span className="data-row-count">{t("list.comments", { count: issue.commentsCount })}</span>
            {issue.assignees && issue.assignees.length ? (
              <span className="data-row-assignees">
                {issue.assignees.slice(0, 3).map((assignee) => (
                  <Avatar key={assignee.login} login={assignee.login} size={18} />
                ))}
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="row-actions">
        <button type="button" className="reply-toggle" onClick={() => setExpanded(true)}>{t("reply.button")}</button>
        <a className="row-open" href={issue.url} target="_blank" rel="noreferrer">{t("thread.openGithub")}</a>
      </div>
      {expanded ? <IssueThread repo={issue.repository.nameWithOwner} number={issue.number} /> : null}
    </div>
  );
}

export function IssueList({ issues }: { issues: GhIssue[] }) {
  const { t } = useI18n();
  if (!issues.length) {
    return <div className="empty"><div className="big">{t("empty.issuesTitle")}</div><div>{t("empty.tryClearing")}</div></div>;
  }

  return (
    <div className="data-list">
      {issues.map((issue) => <IssueRow issue={issue} key={issue.url} />)}
    </div>
  );
}
