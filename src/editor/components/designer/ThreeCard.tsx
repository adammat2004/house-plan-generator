"use client";

import { useEffect, useState } from "react";
import { CubeIcon } from "@/components/ui/icons";
import { editor, useDocumentState, useSessionState } from "../../state/editor";
import { useLook } from "./RoomGallery";
import { useStill } from "./useStill";

/** A still twice the card's size, so it stays sharp on a high-density screen. */
const STILL = { width: 560, height: 400 };
/** How long the plan has to stay as it is before the card draws it again, ms. */
const SETTLE = 400;

/**
 * The house in 3D beside the 2D plan: a still from the shared stills
 * renderer (no live viewer of its own), redrawn once an edit has settled,
 * with the old picture kept until the new one is ready. It folds to a chip
 * while the inspector is open, opens the 3D view when clicked, and isn't
 * there at all where 3D can't be drawn.
 */
export function ThreeCard() {
  const doc = useDocumentState((s) => s.history.present);
  const inspecting = useSessionState((s) => s.selection !== null);
  const { appearance } = useLook();
  const [shown, setShown] = useState(doc);
  useEffect(() => {
    if (doc === shown) return;
    const t = window.setTimeout(() => setShown(doc), SETTLE);
    return () => window.clearTimeout(t);
  }, [doc, shown]);
  const { ref, url } = useStill(shown, { kind: "exterior" }, STILL, appearance);
  // The last picture drawn, shown while the next is on its way.
  const [last, setLast] = useState<string | null>(null);
  if (url && url !== last) setLast(url);
  const src = url ?? last;
  if (url === null && !last) return null;

  const open = () => editor.setShow3d(true);
  if (inspecting) {
    return (
      <button type="button" className="three-chip floating" onClick={open} ref={ref} data-testid="three-card-chip" aria-label="Open the 3D view">
        <CubeIcon width={16} height={16} /> 3D
      </button>
    );
  }
  return (
    <button type="button" className="three-card floating" onClick={open} ref={ref} data-testid="three-card" aria-label="Open the 3D view">
      {/* eslint-disable-next-line @next/next/no-img-element -- a data URL made in the browser */}
      {src ? <img src={src} alt="" /> : <span className="photo-empty">Drawing…</span>}
      <span className="photo-badge">
        <CubeIcon width={12} height={12} /> 3D view
      </span>
    </button>
  );
}
