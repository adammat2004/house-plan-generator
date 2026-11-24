"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/controls";
import { DEFAULT_INTERIOR_STYLE } from "@/domain/design/renderRequest";
import { canFurnish } from "@/domain/furniture/furnish";
import { furnitureInRoom } from "@/domain/furniture/layout";
import type { Id } from "@/domain/plan/types";
import { INTERIOR_STYLE_LABEL, INTERIOR_STYLES, type InteriorStyle } from "@/domain/project/schema";
import { borrowedStyleNote } from "../../rendering/assets/manifest";
import { editor, useDocumentState, useProjectState, useSessionState } from "../../state/editor";

/** Says a style borrows another's pieces, rather than silently showing them. */
export function StyleNote({ style }: { style: InteriorStyle }) {
  const note = borrowedStyleNote(style);
  return note ? (
    <small className="field-hint" data-testid="style-note">
      {note} for now
    </small>
  ) : null;
}

/** Chooses an interior style and furnishes the rooms in it, after saying what it replaces. */
export function FurnishInStyleDialog() {
  const request = useSessionState((s) => s.furnishDialog);
  return request ? <Dialog roomIds={request.roomIds} /> : null;
}

function Dialog({ roomIds }: { roomIds?: Id[] }) {
  const doc = useDocumentState((s) => s.history.present);
  const projectStyle = useProjectState((s) => s.appearance?.interiorStyle) ?? DEFAULT_INTERIOR_STYLE;
  const titleId = useId();
  const scope = doc.levels.flatMap((level) => Object.values(level.rooms).filter((r) => canFurnish(r.type) && (roomIds ? roomIds.includes(r.id) : !r.locked)).map((r) => ({ level, room: r })));
  const own = roomIds?.length === 1 ? scope[0]?.room.interiorStyle : undefined;
  const [style, setStyle] = useState<InteriorStyle>(own ?? projectStyle);
  const replacing = scope.reduce((n, { level, room }) => n + furnitureInRoom(level, room.id).length, 0);
  const where = roomIds?.length === 1 && scope[0] ? scope[0].room.name : `${scope.length} room${scope.length === 1 ? "" : "s"}`;
  const close = () => editor.closeFurnishDialog();
  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="furnish-style-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <h2 id={titleId}>Furnish {roomIds?.length === 1 ? where : "the whole house"} in a style</h2>
        <div className="swatch-grid" role="radiogroup" aria-label="Interior style" data-testid="furnish-style-choices">
          {INTERIOR_STYLES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={style === s} className={style === s ? "is-active" : undefined} onClick={() => setStyle(s)} data-testid={`furnish-style-${s}`}>
              <span>
                {INTERIOR_STYLE_LABEL[s]}
                <br />
                <StyleNote style={s} />
              </span>
            </button>
          ))}
        </div>
        <p className="dialog-lead" data-testid="furnish-style-summary">
          {scope.length === 0
            ? "There is no room here that I can furnish."
            : replacing > 0
              ? `This lays out ${where} again and replaces the ${replacing} piece${replacing === 1 ? "" : "s"} of furniture in ${scope.length === 1 ? "it" : "them"}. Undo brings them back.`
              : `This furnishes ${where}. Undo takes it back out.`}
        </p>
        <div className="dialog-actions">
          <Button variant="ghost" autoFocus onClick={close} data-testid="furnish-style-cancel">
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={scope.length === 0}
            onClick={() => {
              editor.furnishInStyle(style, roomIds);
              close();
            }}
            data-testid="furnish-style-confirm"
          >
            {replacing > 0 ? "Replace furniture" : "Furnish"}
          </Button>
        </div>
      </div>
    </div>
  );
}
