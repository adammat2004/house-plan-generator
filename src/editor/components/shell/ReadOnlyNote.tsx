"use client";

import { useProjectState, useSessionState } from "../../state/editor";
import { stepOf } from "../../state/steps";
import { SendToComputer } from "./SendToComputer";

/** On a touch-only phone, Refine can be looked at (as a plan, furnished or in 3D); editing happens on a computer. */
export function ReadOnlyNote() {
  const readOnly = useSessionState((s) => s.readOnly);
  const step = useSessionState(stepOf);
  const planId = useProjectState((s) => s.activePlanId);
  if (!readOnly || step !== "refine") return null;
  return (
    <div className="read-only-note floating" role="note" data-chrome="top" data-testid="read-only-note">
      <span>Editing works on a computer.</span>
      <SendToComputer planId={planId} className="btn btn-primary" />
    </div>
  );
}
