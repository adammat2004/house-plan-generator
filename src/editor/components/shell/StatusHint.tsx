"use client";

import { useEffect } from "react";
import { editor, useDocumentState, useSessionState } from "../../state/editor";
import { TOOLS, WORKSPACE_HINT } from "./tools";

const SNAP_LABEL = { endpoint: "Endpoint", junction: "Junction", wall: "On wall", centre: "Centred", grid: "Grid", free: "Free" } as const;

/** Quiet bottom-left readout: cursor position, snap and what the current tool does. */
export function StatusHint() {
  const cursor = useSessionState((s) => s.cursor);
  const snap = useSessionState((s) => s.snap);
  const tool = useSessionState((s) => s.tool);
  const workspace = useSessionState((s) => s.workspace);
  const openingDraft = useSessionState((s) => s.openingDraft);
  const previewIssue = useDocumentState((s) => s.preview?.issue ?? null);
  const hint = WORKSPACE_HINT[workspace] ?? TOOLS.find((t) => t.id === tool)?.hint;
  const message = previewIssue?.message ?? (openingDraft && !openingDraft.valid ? openingDraft.message : null);
  return (
    <footer className="status-hint" aria-label="Status">
      <span className={message ? "status-message is-warning" : "status-message"} data-testid="status-message">
        {message ?? hint}
      </span>
      <span className="status-meta">
        <span data-testid="snap-kind">{snap ? `Snap: ${SNAP_LABEL[snap.kind]}` : ""}</span>
        <span className="coords" data-testid="cursor-coords">
          {cursor ? `${cursor.x.toFixed(2)}, ${cursor.y.toFixed(2)} m` : ""}
        </span>
      </span>
    </footer>
  );
}

/** Transient messages, centred under the top bar. Errors stay until dismissed. */
export function NoticeToast() {
  const notice = useDocumentState((s) => s.notice);
  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    const t = setTimeout(() => editor.clearNotice(), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  return (
    <div className="notice-region" aria-live={notice?.tone === "error" ? "assertive" : "polite"}>
      {notice && (
        <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"} data-testid="notice">
          <span>{notice.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => editor.clearNotice()}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
