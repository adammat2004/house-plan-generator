"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DEFAULT_HOUSE, LIMITS } from "@/domain/plan/defaults";
import { Button } from "@/components/ui/controls";

export interface CreateHouseValues {
  name: string;
  width: number;
  depth: number;
  externalThickness: number;
  internalThickness: number;
  wallHeight: number;
}

interface Props {
  /** "project" starts a new project; "replace" swaps the open project's house outline (undoable). */
  mode: "project" | "replace";
  internalThickness: number;
  /** Returns an error message, or null on success. */
  onCreate: (values: CreateHouseValues) => string | null | Promise<string | null>;
  onCancel: () => void;
}

export const HOUSE_FIELDS = [
  { key: "width", label: "Width", hint: "Outside face to outside face", unit: "m" },
  { key: "depth", label: "Depth", hint: "Outside face to outside face", unit: "m" },
  { key: "externalThickness", label: "External walls", hint: "Thickness", unit: "m" },
  { key: "internalThickness", label: "Internal walls", hint: "Default thickness", unit: "m" },
  { key: "wallHeight", label: "Wall height", hint: "Floor to ceiling", unit: "m" },
] as const;

export type HouseFieldKey = (typeof HOUSE_FIELDS)[number]["key"];

/** Validates the text of the dimension fields; the name is passed through. */
export function parseHouseValues(name: string, text: Record<HouseFieldKey, string>): { ok: true; values: CreateHouseValues } | { ok: false; error: string } {
  const numbers = {} as Record<HouseFieldKey, number>;
  for (const f of HOUSE_FIELDS) {
    const n = Number(text[f.key].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: `${f.label} must be a positive number.` };
    numbers[f.key] = n;
  }
  if (numbers.internalThickness < LIMITS.minWallThickness || numbers.internalThickness > LIMITS.maxWallThickness) {
    return { ok: false, error: `Internal wall thickness must be between ${LIMITS.minWallThickness} and ${LIMITS.maxWallThickness} m.` };
  }
  return { ok: true, values: { name: name.trim() || "My house", ...numbers } };
}

/** Width/depth form with editable wall defaults for a new rectangular house. */
export function CreateHouseDialog({ mode, internalThickness, onCreate, onCancel }: Props) {
  const titleId = useId();
  const [values, setValues] = useState<Record<HouseFieldKey | "name", string>>({
    name: "My house",
    width: String(DEFAULT_HOUSE.width),
    depth: String(DEFAULT_HOUSE.depth),
    externalThickness: String(DEFAULT_HOUSE.externalThickness),
    internalThickness: String(internalThickness),
    wallHeight: String(DEFAULT_HOUSE.wallHeight),
  });
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
    firstInput.current?.select();
  }, []);

  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const parsed = parseHouseValues(values.name, values);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    const message = await onCreate(parsed.values);
    setBusy(false);
    setError(message);
  };

  return (
    <div className="dialog-backdrop">
      <div
        ref={dialog}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="create-house-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
          }
          if (e.key === "Tab" && dialog.current) {
            const focusable = dialog.current.querySelectorAll<HTMLElement>("input, button:not([disabled])");
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 id={titleId}>{mode === "project" ? "New project" : "New house"}</h2>
          <p className="dialog-lead">
            {mode === "project" ? "Start with the outside dimensions of your house. " : "Enter the rectangular footprint. "}
            You can change dimensions later; internal walls keep their positions.
          </p>
          <div className="field">
            <label htmlFor={`${titleId}-name`}>Project name</label>
            <input
              id={`${titleId}-name`}
              ref={firstInput}
              value={values.name}
              maxLength={200}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
          </div>
          <div className="dialog-grid">
            {HOUSE_FIELDS.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={`${titleId}-${f.key}`}>{f.label}</label>
                <div className="input-with-unit">
                  <input
                    id={`${titleId}-${f.key}`}
                    inputMode="decimal"
                    data-testid={`create-${f.key}`}
                    value={values[f.key]}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                  <span className="unit">{f.unit}</span>
                </div>
                <p className="field-hint">{f.hint}</p>
              </div>
            ))}
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {mode === "replace" && <p className="field-hint">Creating a new house replaces the current plan. You can undo it.</p>}
          <div className="dialog-actions">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy} data-testid="create-house-submit">
              {mode === "project" ? "Create project" : "Create house"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
