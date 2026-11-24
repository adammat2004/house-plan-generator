"use client";

import { ArrowLeftIcon, CheckIcon, EyeIcon } from "@/components/ui/icons";
import { assistantTurnOf } from "../../state/assistant";
import { assistant, design, editor, useDocumentState } from "../../state/editor";

/**
 * Across the top of the plan while an option is on show: what it is, a way
 * back to the plan as it is, "hold to compare", and Apply. Nothing on the
 * plan changes until Apply.
 */
export function StagedBanner() {
  const staged = useDocumentState((s) => (s.staged && s.staged.source === s.history.present ? s.staged : null));
  if (!staged) return null;
  const turnId = assistantTurnOf(staged.proposalId);
  return (
    <div className="staged-banner floating" role="status" aria-live="polite" data-chrome="top" data-testid="staged-banner">
      <span className="staged-text">
        <span className="staged-kicker">Previewing</span> <strong>{staged.title}</strong>
        {staged.delta && <span className="staged-delta">{staged.delta}</span>}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        aria-pressed={staged.peek}
        onPointerDown={() => editor.peekStaged(true)}
        onPointerUp={() => editor.peekStaged(false)}
        onPointerLeave={() => editor.peekStaged(false)}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && editor.peekStaged(true)}
        onKeyUp={() => editor.peekStaged(false)}
        data-testid="staged-compare"
      >
        <EyeIcon width={16} height={16} /> Hold to compare
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => (turnId === null ? editor.unstage() : assistant.discard(turnId))} data-testid="staged-back">
        <ArrowLeftIcon width={16} height={16} /> {turnId === null ? "Back" : "Discard"}
      </button>
      <button type="button" className="btn btn-primary btn-sm" onClick={() => (turnId === null ? design.applyProposal(staged.proposalId) : assistant.accept(turnId))} data-testid="staged-apply">
        <CheckIcon width={16} height={16} /> {turnId === null ? "Apply" : "Accept all"}
      </button>
    </div>
  );
}
