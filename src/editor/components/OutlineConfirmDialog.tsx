"use client";

import { useId } from "react";
import { Button } from "@/components/ui/controls";
import { levelIndex } from "@/domain/plan/levels";
import { useActiveLevel, useDocumentState, useSessionState } from "../state/editor";
import { toolController } from "../tools/instance";

/** Asks before a drawn outline replaces a house that already has rooms in it. */
export function OutlineConfirmDialog() {
  const pending = useSessionState((s) => s.outlineConfirm);
  const level = useActiveLevel();
  const rooms = Object.keys(level.rooms).length;
  const index = useDocumentState((s) => levelIndex(s.history.present, level.id));
  const above = useDocumentState((s) => s.history.present.levels.length - 1 - levelIndex(s.history.present, level.id));
  const what = index === 0 ? "the house" : `the ${level.name.toLowerCase()}`;
  const titleId = useId();
  if (!pending) return null;
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="outline-confirm"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            toolController.confirmOutline(false);
          }
        }}
      >
        <h2 id={titleId}>Replace {what}?</h2>
        <p className="dialog-lead">
          The new outline replaces {what}: its {rooms} room{rooms === 1 ? "" : "s"}, walls, doors, windows and furniture are removed
          {above > 0 ? `, and the floor${above === 1 ? "" : "s"} above start${above === 1 ? "s" : ""} again over the new outline` : ""}. Undo brings them back.
        </p>
        <p className="field-hint">To reshape the house and keep its rooms, drag its outside walls and corners with Select instead.</p>
        <div className="dialog-actions">
          <Button variant="ghost" autoFocus onClick={() => toolController.confirmOutline(false)} data-testid="outline-confirm-keep">
            Keep the house
          </Button>
          <Button variant="primary" onClick={() => toolController.confirmOutline(true)} data-testid="outline-confirm-replace">
            Replace the house
          </Button>
        </div>
      </div>
    </div>
  );
}
