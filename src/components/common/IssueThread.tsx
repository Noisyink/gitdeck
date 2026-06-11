import { useEffect, useState } from "react";
import type { ThreadData, ThreadEntry } from "../../types/github";
import { fetchThread, fetchSettings, summarizeThread, type GitdeckSettings } from "../../api/github";
import { formatRelativeTime } from "../../utils/format";
import { Avatar } from "./Avatar";
import { ReplyBox } from "./ReplyBox";
import { useI18n } from "../../i18n/I18nProvider";

// Noisyink fork: inline GitHub-style thread (issue/PR body + timeline) loaded on
// demand when a card is expanded. Comment/review bodies are GitHub's sanitized
// body_html, rendered via dangerouslySetInnerHTML.
export function IssueThread({ repo, number }: { repo: string; number: number }) {
  const { language, t } = useI18n();
  const [data, setData] = useState<ThreadData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  // Noisyink fork: Claude summary state.
  const [settings, setSettings] = useState<GitdeckSettings | null>(null);
  const [summaryModel, setSummaryModel] = useState("claude-haiku-4-5");
  const [summary, setSummary] = useState("");
  const [summarizing, setSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  useEffect(() => {
    fetchSettings()
      .then((res) => { setSettings(res.settings); setSummaryModel(res.settings.summaryModel); })
      .catch(() => setSettings(null));
  }, []);

  async function runSummary(model: string, fresh: boolean) {
    setSummarizing(true);
    setSummaryError("");
    try {
      const res = await summarizeThread(repo, number, model, fresh);
      setSummary(res.summary);
    } catch (err) {
      setSummaryError((err as Error).message || t("summary.error"));
    } finally {
      setSummarizing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    fetchThread(repo, number, controller.signal)
      .then((res) => { if (!controller.signal.aborted) setData(res); })
      .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message || t("thread.error")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [repo, number, reloadKey, t]);

  function eventLabel(entry: Extract<ThreadEntry, { kind: "event" }>): string {
    switch (entry.eventType) {
      case "labeled": return t("event.labeled", { detail: entry.detail });
      case "unlabeled": return t("event.unlabeled", { detail: entry.detail });
      case "closed": return t("event.closed");
      case "reopened": return t("event.reopened");
      case "merged": return t("event.merged");
      case "renamed": return t("event.renamed", { detail: entry.detail });
      case "assigned": return t("event.assigned", { detail: entry.detail });
      case "unassigned": return t("event.unassigned", { detail: entry.detail });
      case "review_requested": return t("event.reviewRequested", { detail: entry.detail });
      case "review_request_removed": return t("event.reviewRequestRemoved", { detail: entry.detail });
      default: return entry.eventType;
    }
  }

  if (loading) return <div className="thread"><div className="thread-status">{t("thread.loading")}</div></div>;
  if (error) return <div className="thread"><div className="thread-status error">{error}</div></div>;
  if (!data) return null;

  return (
    <div className="thread">
      {settings?.summaryEnabled && settings?.anthropicConfigured ? (
        <div className="thread-summary">
          <div className="thread-summary-bar">
            <button type="button" className="summary-btn" disabled={summarizing} onClick={() => runSummary(summaryModel, Boolean(summary))}>
              {summarizing ? t("summary.busy") : summary ? t("summary.regenerate") : t("summary.button")}
            </button>
            <select className="summary-model" value={summaryModel} disabled={summarizing} onChange={(event) => setSummaryModel(event.target.value)}>
              <option value="claude-haiku-4-5">Haiku</option>
              <option value="claude-sonnet-4-6">Sonnet</option>
              <option value="claude-opus-4-8">Opus</option>
            </select>
          </div>
          {summaryError ? <div className="summary-error">{summaryError}</div> : null}
          {summary ? <div className="summary-text">{summary}</div> : null}
        </div>
      ) : null}
      <article className="thread-comment">
        <Avatar login={data.item.author?.login} size={28} />
        <div className="thread-comment-body">
          <div className="thread-comment-head">
            <strong>{data.item.author?.login || "unknown"}</strong>
            <em>{formatRelativeTime(data.item.createdAt, Date.now(), language)}</em>
          </div>
          {data.item.bodyHtml
            ? <div className="thread-body" dangerouslySetInnerHTML={{ __html: data.item.bodyHtml }} />
            : <div className="thread-body muted">{t("thread.empty")}</div>}
        </div>
      </article>

      {data.entries.map((entry, index) => {
        if (entry.kind === "event") {
          return (
            <div className="thread-event" key={index}>
              <span className="thread-event-actor">{entry.actor?.login || "someone"}</span>{" "}
              <span>{eventLabel(entry)}</span>{" "}
              <em>{formatRelativeTime(entry.createdAt, Date.now(), language)}</em>
            </div>
          );
        }
        const isReview = entry.kind === "review";
        return (
          <article className={isReview ? "thread-comment review" : "thread-comment"} key={index}>
            <Avatar login={entry.actor?.login} size={28} />
            <div className="thread-comment-body">
              <div className="thread-comment-head">
                <strong>{entry.actor?.login || "unknown"}</strong>
                {isReview ? <span className={`thread-review-state ${entry.state.toLowerCase()}`}>{entry.state.toLowerCase()}</span> : null}
                <em>{formatRelativeTime(entry.createdAt, Date.now(), language)}</em>
              </div>
              {entry.bodyHtml ? <div className="thread-body" dangerouslySetInnerHTML={{ __html: entry.bodyHtml }} /> : null}
            </div>
          </article>
        );
      })}

      {data.truncated ? (
        <div className="thread-truncated">
          {t("thread.truncated")} <a href={data.item.url} target="_blank" rel="noreferrer">{t("thread.openGithub")}</a>
        </div>
      ) : null}
      <ReplyBox repo={repo} number={number} startOpen onPosted={() => setReloadKey((key) => key + 1)} />
    </div>
  );
}
