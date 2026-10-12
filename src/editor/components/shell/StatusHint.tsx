"use client";

import { useEffect } from "react";
import { editor, useActiveLevel, useDocumentState, useSessionState } from "../../state/editor";
import { inRefine } from "../../state/stores";
import { TOOLS } from "./tools";

const SNAP_LABEL = { endpoint: "Endpoint", junction: "Junction", wall: "On wall", centre: "Centred", grid: "Grid", free: "Free" } as const;

const OUTLINE_HINT = "Drag outside walls to move them, Alt-drag for a bay, or drag a corner square to cut a notch.";

/**
 * A quiet line above the dock: a problem with what's being drawn, or what the
 * active tool does. Nothing while just looking at the plan; the side panel
 * says what to do there.
 */
export function StatusHint() {
  const snap = useSessionState((s) => s.snap);
  const tool = useSessionState((s) => s.tool);
  const refining = useSessionState(inRefine);
  const openingDraft = useSessionState((s) => s.openingDraft);
  const previewIssue = useDocumentState((s) => s.preview?.issue ?? null);
  const selection = useSessionState((s) => s.selection);
  const level = useActiveLevel();
  const outsideWall = selection?.kind === "wall" && level.walls[selection.id]?.role === "external";
  const reshaping = refining && tool === "select" && (outsideWall || selection?.kind === "house");
  const hint = reshaping ? OUTLINE_HINT : tool !== "select" ? TOOLS.find((t) => t.id === tool)?.hint : undefined;
  const outlineProblem = useSessionState((s) => s.outlineDraft?.problem ?? null);
  const stairsProblem = useSessionState((s) => s.stairsDraft?.message ?? null);
  const message = previewIssue?.message ?? (openingDraft && !openingDraft.valid ? openingDraft.message : null) ?? outlineProblem ?? stairsProblem;
  if (!message && !hint && !snap) return null;
  return (
    <footer className="status-hint" aria-label="Status">
      <span className={message ? "status-message is-warning" : "status-message"} data-testid="status-message">
        {message ?? hint}
      </span>
      <span className="status-meta">
        <span data-testid="snap-kind">{snap ? `Snap: ${SNAP_LABEL[snap.kind]}` : ""}</span>
      </span>
    </footer>
  );
}

/** Transient messages, centred under the top bar. Errors stay until dismissed. */
export function NoticeToast() {
  const notice = useDocumentState((s) => s.notice);
  useEffect(() => {
    if (!notice || notice.tone === "error") return;
    // Four seconds, longer for a message that takes longer to read.
    const t = setTimeout(() => editor.clearNotice(), Math.max(4000, notice.message.length * 60));
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
