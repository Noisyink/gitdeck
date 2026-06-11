import { useState } from "react";
import { postComment } from "../../api/github";
import { useI18n } from "../../i18n/I18nProvider";

// Noisyink fork: inline reply box on PR/Issue cards. Posts a comment to GitHub
// behind a confirm step, so the dashboard can act without opening GitHub. The
// card itself is an anchor, so this renders as a sibling outside it.
type Status = "idle" | "confirm" | "posting" | "done" | "error";

export function ReplyBox({ repo, number, startOpen = false, onPosted }: { repo: string; number: number; startOpen?: boolean; onPosted?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(startOpen);
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");
  const [postedUrl, setPostedUrl] = useState("");

  const target = `${repo} #${number}`;

  function close() {
    setOpen(startOpen);
    setBody("");
    setError("");
    setStatus("idle");
  }

  async function submit() {
    setStatus("posting");
    setError("");
    try {
      const res = await postComment({ repo, number, body: body.trim() });
      setPostedUrl(res.htmlUrl);
      setBody("");
      // In the thread view, clear and let the refreshed thread show the comment;
      // standalone, show a confirmation with a link.
      if (onPosted) {
        setStatus("idle");
        onPosted();
      } else {
        setStatus("done");
      }
    } catch (err) {
      setError((err as Error).message || t("reply.error"));
      setStatus("error");
    }
  }

  if (!open) {
    return (
      <button type="button" className="reply-toggle" onClick={() => setOpen(true)}>
        {t("reply.button")}
      </button>
    );
  }

  return (
    <div className="reply-box">
      {status === "done" ? (
        <div className="reply-done">
          <span>{t("reply.posted")}</span>
          {postedUrl ? (
            <a href={postedUrl} target="_blank" rel="noreferrer">{t("reply.viewComment")}</a>
          ) : null}
          <button type="button" className="reply-link" onClick={close}>{t("reply.cancel")}</button>
        </div>
      ) : (
        <>
          <textarea
            className="reply-input"
            placeholder={t("reply.placeholder")}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={status === "posting"}
            rows={3}
          />
          {error ? <div className="reply-error">{error}</div> : null}
          {status === "confirm" ? (
            <div className="reply-confirm">
              <span className="reply-confirm-text">{t("reply.confirmBody", { target })}</span>
              <div className="reply-actions">
                <button type="button" className="reply-cancel" onClick={() => setStatus("idle")}>{t("reply.cancel")}</button>
                <button type="button" className="reply-send" onClick={submit}>{t("reply.send")}</button>
              </div>
            </div>
          ) : (
            <div className="reply-actions">
              <button type="button" className="reply-cancel" onClick={close}>{t("reply.cancel")}</button>
              <button
                type="button"
                className="reply-send"
                disabled={!body.trim() || status === "posting"}
                onClick={() => setStatus("confirm")}
              >
                {status === "posting" ? t("reply.posting") : t("reply.send")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
