"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { DEFAULT_INTERIOR_STYLE, photoTargets, renderKey, targetKey, type StillTarget } from "@/domain/design/renderRequest";
import { roomRegion } from "@/domain/design/analysis";
import { formatArea } from "@/domain/geometry/numeric";
import type { Level } from "@/domain/plan/types";
import { DEFAULT_APPEARANCE, INTERIOR_STYLE_LABEL, INTERIOR_STYLES, type Appearance, type InteriorStyle } from "@/domain/project/schema";
import { IconButton } from "@/components/ui/controls";
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon, DownloadIcon, ImageIcon, SparkleIcon } from "@/components/ui/icons";
import { editor, renders, useProjectState, useRenders } from "../../state/editor";
import type { PhotoEntry } from "../../state/renders";
import { useStill } from "./useStill";

/**
 * A concept's rooms as pictures: a photo where one has been rendered, else
 * an instant 3D view. "Render rooms" sends each 3D view to the image model
 * (a paid call each) and keeps the photos with the project.
 */

const TILE = { width: 320, height: 240 };
const LARGE = { width: 1024, height: 768 };

export function useLook(): { appearance: Appearance; style: InteriorStyle } {
  const stored = useProjectState((s) => s.appearance);
  const appearance = { ...DEFAULT_APPEARANCE, ...stored };
  return { appearance, style: appearance.interiorStyle ?? DEFAULT_INTERIOR_STYLE };
}

const nameOf = (level: Level, t: StillTarget) => (t.kind === "room" ? (level.rooms[t.roomId]?.name ?? "Room") : t.kind === "aerial" ? "From above" : "Exterior");

export function RoomGallery({ planId, level }: { planId: string; level: Level }) {
  const { appearance, style } = useLook();
  const photos = useRenders((s) => s.byPlan[planId]);
  const batch = useRenders((s) => s.batch);
  const available = useRenders((s) => s.available);
  const error = useRenders((s) => s.error);
  const [open, setOpen] = useState<number | null>(null);
  const targets = photoTargets(level);
  const running = !!batch;
  const mine = batch?.planId === planId;
  const stale = targets.filter((t) => photos?.[targetKey(t)] && photos[targetKey(t)].sourceHash !== renderKey(level, t, appearance, style)).length;
  const missing = targets.filter((t) => !photos?.[targetKey(t)]).length;

  return (
    <div className="room-gallery" data-testid="room-gallery">
      <div className="gallery-controls">
        <label className="gallery-style">
          <span>Interior style</span>
          <select value={style} onChange={(e) => editor.setAppearance({ interiorStyle: e.currentTarget.value as InteriorStyle })} data-testid="interior-style">
            {INTERIOR_STYLES.map((s) => (
              <option key={s} value={s}>
                {INTERIOR_STYLE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {mine ? (
          <div className="gallery-progress" role="status" data-testid="render-progress">
            <span>
              Rendering {Math.min(batch.done + 1, batch.total)} of {batch.total}
              {batch.current ? `: ${batch.current}` : ""}…
            </span>
            <button type="button" className="link-btn" onClick={() => renders.cancel()}>
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={available !== "yes" || running}
            onClick={() => void renders.renderPlan(planId, level, appearance, style, { force: !missing && !stale })}
            data-testid="render-rooms"
          >
            <SparkleIcon width={16} height={16} /> {missing === targets.length ? "Render rooms" : missing || stale ? `Render ${missing + stale} more` : "Render again"}
          </button>
        )}
      </div>
      {available === "no" ? (
        <p className="field-hint" data-testid="render-setup">
          Photo renders need a Google Gemini key: add GEMINI_API_KEY to .env.local and restart the app. The 3D views below work without it.
        </p>
      ) : (
        <p className="field-hint">Each photo is a paid call to Google&rsquo;s Gemini image model, made from the 3D view of the room. Photos are kept with the project.</p>
      )}
      {error && !mine && (
        <p className="gallery-error" role="alert" data-testid="render-error">
          {error}
        </p>
      )}
      <ul className="gallery-grid">
        {targets.map((target, i) => (
          <li key={targetKey(target)}>
            <PhotoTile level={level} target={target} appearance={appearance} style={style} photo={photos?.[targetKey(target)]} onOpen={() => setOpen(i)} />
          </li>
        ))}
      </ul>
      {open !== null && targets[open] && (
        <Lightbox
          level={level}
          target={targets[open]}
          appearance={appearance}
          photo={photos?.[targetKey(targets[open])]}
          onClose={() => setOpen(null)}
          onStep={(d) => setOpen((open + d + targets.length) % targets.length)}
        />
      )}
    </div>
  );
}

function PhotoTile({ level, target, appearance, style, photo, onOpen }: { level: Level; target: StillTarget; appearance: Appearance; style: InteriorStyle; photo?: PhotoEntry; onOpen: () => void }) {
  const { ref, url } = useStill(level, target, TILE, appearance);
  const name = nameOf(level, target);
  const area = target.kind === "room" ? roomRegion(level, target.roomId)?.clearArea : undefined;
  const outdated = photo && photo.sourceHash !== renderKey(level, target, appearance, style);
  const src = photo?.url ?? url;
  return (
    <button type="button" className="photo-tile" onClick={onOpen} data-testid={`photo-${name}`}>
      <span className="photo-frame" ref={ref}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- object and data URLs made in the browser
          <img src={src} alt={`${name}${photo ? "" : ", 3D view"}`} data-kind={photo ? "photo" : "still"} />
        ) : (
          <span className="photo-empty">{url === null ? <ImageIcon width={22} height={22} /> : "Drawing…"}</span>
        )}
        {!photo && src && <span className="photo-badge">3D preview</span>}
        {outdated && (
          <span className="photo-badge is-stale" data-testid="photo-stale">
            Out of date
          </span>
        )}
      </span>
      <span className="photo-caption">
        <strong>{name}</strong>
        {area !== undefined && <small>{formatArea(area)}</small>}
      </span>
    </button>
  );
}

function Lightbox({ level, target, appearance, photo, onClose, onStep }: { level: Level; target: StillTarget; appearance: Appearance; photo?: PhotoEntry; onClose: () => void; onStep: (d: 1 | -1) => void }) {
  const { ref, url } = useStill(level, target, LARGE, appearance);
  const name = nameOf(level, target);
  const src = photo?.url ?? url;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === "ArrowLeft") onStep(-1);
      else return;
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onStep]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={name} onClick={onClose} data-testid="lightbox">
      <figure onClick={(e) => e.stopPropagation()} ref={ref}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- object and data URLs made in the browser
          <img src={src} alt={name} />
        ) : (
          <span className="photo-empty">Drawing…</span>
        )}
        <figcaption>
          <strong>{name}</strong>
          <span>{photo ? `Photo render · ${new Date(photo.createdAt).toLocaleDateString()}` : "3D view"}</span>
          {src && (
            <a className="btn btn-outline btn-sm" href={src} download={`${name}.jpg`}>
              <DownloadIcon width={15} height={15} /> Download
            </a>
          )}
        </figcaption>
        <IconButton label="Previous" className="lightbox-prev" onClick={() => onStep(-1)}>
          <ChevronLeftIcon width={20} height={20} />
        </IconButton>
        <IconButton label="Next" className="lightbox-next" onClick={() => onStep(1)}>
          <ChevronRightIcon width={20} height={20} />
        </IconButton>
        <IconButton label="Close" className="lightbox-close" onClick={onClose}>
          <CloseIcon width={20} height={20} />
        </IconButton>
      </figure>
    </div>,
    document.body,
  );
}

/** Up to three small pictures of a concept's rooms for its card: photos where there are some, else 3D views. */
export function CardPhotos({ planId, level }: { planId: string; level: Level }) {
  const { appearance } = useLook();
  const photos = useRenders((s) => s.byPlan[planId]);
  const targets = photoTargets(level, 4).slice(1, 4);
  return (
    <span className="card-photos" aria-hidden>
      {targets.map((t) => (
        <CardPhoto key={targetKey(t)} level={level} target={t} appearance={appearance} photo={photos?.[targetKey(t)]} />
      ))}
    </span>
  );
}

function CardPhoto({ level, target, appearance, photo }: { level: Level; target: StillTarget; appearance: Appearance; photo?: PhotoEntry }) {
  const { ref, url } = useStill(level, target, { width: 200, height: 150 }, appearance);
  const src = photo?.url ?? url;
  return (
    <span className="card-photo" ref={ref}>
      {/* eslint-disable-next-line @next/next/no-img-element -- object and data URLs made in the browser */}
      {src && <img src={src} alt="" />}
    </span>
  );
}
