"use client";

import { useRef, useState } from "react";
import { pickedBathrooms, pickedBedrooms } from "@/domain/brief/rooms";
import { briefFromPicture, PICTURE_KIND_LABEL, PICTURE_KINDS, type PictureKind, type PictureReply } from "@/domain/design/pictureReading";
import { HOUSE_SHAPE_LABEL, type HouseBrief } from "@/domain/brief/schema";
import { SegmentedControl } from "@/components/ui/controls";
import { ImageIcon } from "@/components/ui/icons";
import { editor, useProjectState } from "../../state/editor";
import { roomInstances } from "./Studio";

/**
 * "Add a picture": a floor plan you like, inspiration, or your site plan,
 * read by Claude into the rooms, shape and storeys (and notes for the rest).
 * Nothing changes until "Use this". Pictures are scaled down in the browser
 * and aren't kept.
 */

/** Longest side sent, px: enough to read a plan's labels. */
const MAX_SIDE = 1568;

/** The picture as a JPEG no bigger than MAX_SIDE, base64 without a data: prefix. */
async function shrink(file: File): Promise<{ image: string; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  // Transparent PNG plans read better on white.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const preview = canvas.toDataURL("image/jpeg", 0.85);
  return { image: preview.slice(preview.indexOf(",") + 1), preview };
}

type State = { phase: "idle" } | { phase: "reading"; preview: string } | { phase: "read"; preview: string; reply: PictureReply; next: HouseBrief } | { phase: "failed"; preview?: string; message: string };

export function PictureReader() {
  const brief = useProjectState((s) => s.brief);
  const [kind, setKind] = useState<PictureKind>("floor_plan");
  const [state, setState] = useState<State>({ phase: "idle" });
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > 12_000_000) {
      setState({ phase: "failed", message: "Add a JPEG, PNG or WebP picture under 12 MB." });
      return;
    }
    let shrunk: { image: string; preview: string };
    try {
      shrunk = await shrink(file);
    } catch {
      setState({ phase: "failed", message: "This browser couldn't open that picture." });
      return;
    }
    setState({ phase: "reading", preview: shrunk.preview });
    try {
      const response = await fetch("/api/design/picture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, mediaType: "image/jpeg", image: shrunk.image, rooms: brief.rooms ?? {} }),
      });
      const body = (await response.json().catch(() => ({}))) as { reply?: PictureReply; error?: string };
      if (!response.ok || !body.reply) {
        setState({ phase: "failed", preview: shrunk.preview, message: body.error ?? "The picture couldn't be read." });
        return;
      }
      setState({ phase: "read", preview: shrunk.preview, reply: body.reply, next: briefFromPicture(brief, body.reply) });
    } catch {
      setState({ phase: "failed", preview: shrunk.preview, message: "Couldn't reach the server. Check your connection and try again." });
    }
  };

  const changes = state.phase === "read" ? describeChanges(brief, state.next) : [];

  return (
    <section className="picture-reader" aria-label="Add a picture" data-testid="picture-reader">
      <h3>Start from a picture</h3>
      <p className="studio-hint">A floor plan you like, a house you love, or your site plan. We&rsquo;ll read it into your rooms.</p>
      <SegmentedControl label="What the picture shows" value={kind} options={PICTURE_KINDS.map((k) => ({ value: k, label: PICTURE_KIND_LABEL[k] }))} onChange={setKind} size="sm" testIdPrefix="picture-kind" />
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        data-testid="picture-input"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (file) void read(file);
        }}
      />
      {state.phase === "idle" && (
        <button type="button" className="btn btn-secondary btn-md picture-add" onClick={() => input.current?.click()} data-testid="picture-add">
          <ImageIcon width={16} height={16} /> Add a picture
        </button>
      )}
      {state.phase !== "idle" && (
        <div className="picture-result" role="status" aria-live="polite" data-testid="picture-result">
          {"preview" in state && state.preview && (
            // eslint-disable-next-line @next/next/no-img-element -- a picture scaled down in the browser
            <img src={state.preview} alt="The picture you added" />
          )}
          <div>
            {state.phase === "reading" && <p>Reading the picture…</p>}
            {state.phase === "failed" && <p className="field-error">{state.message}</p>}
            {state.phase === "read" && (
              <>
                <p>{state.reply.reply}</p>
                {changes.length ? (
                  <ul className="picture-changes">
                    {changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="studio-hint">Nothing in it changes your rooms.</p>
                )}
              </>
            )}
            <div className="picture-actions">
              {state.phase === "read" && changes.length > 0 && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    editor.setBrief(state.next);
                    setState({ phase: "idle" });
                  }}
                  data-testid="picture-use"
                >
                  Use this
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setState({ phase: "idle" })} disabled={state.phase === "reading"} data-testid="picture-dismiss">
                {state.phase === "read" ? "Not now" : "Close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/** What using the reading would change, in words. */
function describeChanges(before: HouseBrief, after: HouseBrief): string[] {
  const out: string[] = [];
  if (JSON.stringify(before.rooms ?? {}) !== JSON.stringify(after.rooms ?? {})) {
    const picks = after.rooms ?? {};
    out.push(`Rooms: ${pickedBedrooms(picks)} bed, ${pickedBathrooms(picks)} bath, ${roomInstances(picks).length} rooms in all`);
  }
  if ((before.houseShape ?? "rectangle") !== (after.houseShape ?? "rectangle")) out.push(`Shape: ${HOUSE_SHAPE_LABEL[after.houseShape ?? "rectangle"]}`);
  if ((before.storeys ?? 1) !== (after.storeys ?? 1)) out.push(after.storeys === 2 ? "Two storeys" : "One storey");
  if (before.additionalInstructions !== after.additionalInstructions) out.push("Notes added to your brief");
  return out;
}
