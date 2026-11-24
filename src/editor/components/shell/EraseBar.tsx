"use client";

import { RefreshIcon } from "@/components/ui/icons";
import { design, editor, useActiveLevel, useSessionState } from "../../state/editor";
import { selectTool } from "./tools";

/**
 * Under the plan while erasing: how many rooms are brushed out, and
 * Regenerate to lay them out again in the space they share. One room gets
 * its variations; several are laid out again together. Everything else in
 * the plan stays as it is.
 */
export function EraseBar() {
  const tool = useSessionState((s) => s.tool);
  const erased = useSessionState((s) => s.erased);
  const running = useSessionState((s) => s.designer.status === "running");
  const level = useActiveLevel(true);
  if (tool !== "erase") return null;
  const names = erased.map((id) => level.rooms[id]?.name).filter(Boolean);
  const regenerate = () => {
    const ids = [...erased];
    selectTool("select");
    if (ids.length === 1) void design.openRoomVariations(ids[0]);
    else void design.regenerateArea(ids);
  };
  return (
    <div className="erase-bar floating" role="toolbar" aria-label="Erase" data-testid="erase-bar">
      <span className="erase-bar-text" aria-live="polite">
        {erased.length ? (
          <>
            <strong>{erased.length === 1 ? "1 room erased" : `${erased.length} rooms erased`}</strong>
            <small>{names.join(", ")}</small>
          </>
        ) : (
          <strong>Brush over the rooms to lay out again</strong>
        )}
      </span>
      <button type="button" className="btn btn-ghost btn-md" disabled={!erased.length} onClick={() => editor.setErased([])} data-testid="erase-clear">
        Clear
      </button>
      <button type="button" className="btn btn-primary btn-md" disabled={!erased.length || running} onClick={regenerate} data-testid="erase-regenerate">
        <RefreshIcon width={16} height={16} /> Regenerate
      </button>
    </div>
  );
}
