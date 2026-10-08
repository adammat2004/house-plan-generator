"use client";

import { useState } from "react";
import { useStore } from "zustand";
import type { Id } from "@/domain/plan/types";
import type { PlanVariantMeta } from "@/domain/project/schema";
import { CloseIcon, PlusIcon, SparkleIcon } from "@/components/ui/icons";
import { editor, editorStores, useProjectState } from "../../state/editor";
import { toolController } from "../../tools/instance";
import { PlanThumbnail } from "./PlanThumbnail";

/**
 * Alternative plans, side by side at the bottom of the canvas. Shown only
 * when there is more than one plan. Switching keeps each plan's own undo.
 */
export function VariationTray() {
  const plans = useProjectState((s) => s.plans);
  const activePlanId = useProjectState((s) => s.activePlanId);
  const parked = useProjectState((s) => s.parked);
  const active = useStore(editorStores.documents, (s) => s.history.present);
  if (plans.length < 2) return null;
  return (
    <nav className="variation-tray floating" aria-label="Plans" data-testid="variation-tray">
      <div className="tray-plans" role="radiogroup" aria-label="Plans">
        {plans.map((plan) => (
          <PlanTile key={plan.id} plan={plan} active={plan.id === activePlanId} level={(plan.id === activePlanId ? active : parked[plan.id]?.present)?.levels[0]} />
        ))}
      </div>
      <button type="button" className="tray-add" onClick={() => editor.duplicatePlan()} data-testid="add-variation" data-tooltip="Copy this plan as a new variation" data-tooltip-side="top">
        <PlusIcon width={16} height={16} />
        Variation
      </button>
    </nav>
  );
}

function PlanTile({ plan, active, level }: { plan: PlanVariantMeta; active: boolean; level: Parameters<typeof PlanThumbnail>[0]["level"] | undefined }) {
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const generated = plan.origin.kind === "generated";
  const tooltip = generated && plan.origin.kind === "generated" ? plan.origin.summary ?? "Generated layout" : plan.parentId ? "Variation" : "Your plan";
  const choose = (id: Id) => {
    if (editor.switchPlan(id)) requestAnimationFrame(() => toolController.fitPlan());
  };
  return (
    <div className={`plan-tile${active ? " is-active" : ""}`} onMouseLeave={() => setConfirming(false)}>
      <button
        type="button"
        role="radio"
        aria-checked={active}
        className="plan-tile-main"
        onClick={() => choose(plan.id)}
        onDoubleClick={() => setRenaming(true)}
        data-testid={`plan-${plan.label}`}
        data-tooltip={tooltip}
        data-tooltip-side="top"
      >
        {level ? <PlanThumbnail level={level} /> : <span className="plan-thumb" />}
        {renaming ? null : (
          <span className="plan-tile-label">
            {generated && <SparkleIcon width={11} height={11} />}
            {plan.label}
          </span>
        )}
      </button>
      {renaming && (
        <input
          className="plan-tile-rename"
          aria-label="Plan name"
          defaultValue={plan.label}
          maxLength={60}
          autoFocus
          onBlur={(e) => {
            editor.renamePlan(plan.id, e.currentTarget.value);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      )}
      {confirming ? (
        <button type="button" className="plan-tile-confirm" onClick={() => editor.deletePlan(plan.id)} data-testid={`delete-plan-confirm-${plan.label}`}>
          Delete
        </button>
      ) : (
        <button type="button" className="plan-tile-delete" aria-label={`Delete ${plan.label}`} onClick={() => setConfirming(true)} data-testid={`delete-plan-${plan.label}`}>
          <CloseIcon width={12} height={12} />
        </button>
      )}
    </div>
  );
}
