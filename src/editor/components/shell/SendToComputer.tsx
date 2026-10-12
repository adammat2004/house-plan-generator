"use client";

import { useState } from "react";
import { encodeSnapshot, snapshotOf } from "@/domain/project/startLink";
import { SendIcon } from "@/components/ui/icons";
import { editor, editorStores } from "../../state/editor";
import { projectDocument } from "../../state/stores";

/**
 * "Send to my computer": shares a link that opens this layout on another
 * device (see domain/project/startLink.ts). Uses the share sheet where there
 * is one, else copies the link; if neither works, shows it to copy by hand.
 */
export function SendToComputer({ planId, className = "btn btn-secondary btn-md" }: { planId: string; className?: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      const project = projectDocument(editorStores);
      const snapshot = snapshotOf(project, planId);
      if (!snapshot) return;
      const url = `${window.location.origin}/start#${await encodeSnapshot(snapshot)}`;
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: `${project.name}: open on your computer`, url });
          return;
        } catch (error) {
          // Closing the share sheet isn't a failure.
          if ((error as Error).name === "AbortError") return;
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        editor.notify("success", "Link copied. Open it on your computer to keep editing.");
      } catch {
        setLink(url);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className} onClick={() => void send()} disabled={busy} aria-busy={busy} data-testid="send-to-computer">
        <SendIcon width={16} height={16} /> Send to my computer
      </button>
      {link && (
        <label className="field send-link">
          <span className="field-label">Copy this link, then open it on your computer</span>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} data-testid="send-link" />
        </label>
      )}
    </>
  );
}
