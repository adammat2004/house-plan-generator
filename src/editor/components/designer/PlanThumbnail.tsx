"use client";

import { memo, type ReactNode, useId } from "react";
import type { Ring } from "@/domain/geometry/polygons";
import type { Rect } from "@/domain/geometry/vector";
import type { Level, PlanDocument, RoomType } from "@/domain/plan/types";
import { PLAN_THEME as T } from "../../rendering/konva/theme";
import { roomColour, zoneColour } from "@/design/roomColours";
import { FINISH_TONE, finishTile, roomFinish, type FinishId } from "../../rendering/scene/finishes";
import { buildPlanScene, type PlanScene } from "../../rendering/scene/planScene";
import { buildStairScene, type StairPrimitive } from "../../rendering/scene/stairScene";
import { planFurnitureFill } from "../../rendering/scene/style";
import { assetForItem } from "../../rendering/assets/manifest";
import { spriteTransform } from "../../rendering/konva/sprites";

/** Pictures of plans use the default style's furniture colours. */
const FURNITURE = planFurnitureFill();

/**
 * Coordinates rounded to the millimetre. Drawings are rendered on the server
 * and again in the browser, whose trigonometry can differ in the last digits;
 * rounding keeps both identical so hydration matches.
 */
const pt = (p: { x: number; y: number }) => `${Math.round(p.x * 1000) / 1000} ${Math.round(p.y * 1000) / 1000}`;
export const svgLine = (points: ReadonlyArray<{ x: number; y: number }>, closed = false) => `M${points.map(pt).join("L")}${closed ? "Z" : ""}`;
const path = (rings: Ring[]) => rings.map((ring) => svgLine(ring, true)).join("");
const rectPath = (r: Rect) => svgLine([{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.minY }, { x: r.maxX, y: r.maxY }, { x: r.minX, y: r.maxY }], true);

const mm = (v: number) => Math.round(v * 1000) / 1000;

/** A piece from the asset library's picture of it seen from above, placed and turned like the item (the drawing is flipped, y up). */
function FurniturePicture({ item }: { item: PlanScene["furniture"][number]["item"] }) {
  const asset = assetForItem(item, undefined);
  if (!asset) return null;
  const t = spriteTransform(item, asset);
  return (
    <image
      href={asset.sprite.url}
      x={mm(-t.offsetX)}
      y={mm(-t.offsetY)}
      width={mm(t.width)}
      height={mm(t.height)}
      preserveAspectRatio="none"
      transform={`translate(${mm(t.x)} ${mm(t.y)}) rotate(${t.rotation}) scale(1 -1)`}
    />
  );
}

/** A floor's stairs, for drawings that have the whole house: none for a floor drawn on its own. */
export const stairsOn = (plan: PlanDocument | undefined, level: Level | undefined): readonly StairPrimitive[] | undefined =>
  plan && level && plan.staircases ? buildStairScene(plan, level.id) : undefined;

/** Stairs as on the canvas, without the UP and DOWN words: treads, the cut, and the walking line with its arrow. */
function StairDrawing({ stair }: { stair: StairPrimitive }) {
  const tip = stair.path[stair.path.length - 1];
  const before = stair.path[stair.path.length - 2] ?? tip;
  const len = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const [dx, dy] = [(tip.x - before.x) / len, (tip.y - before.y) / len];
  const head = 0.22;
  const arrow = [
    { x: tip.x - dx * head - dy * head * 0.5, y: tip.y - dy * head + dx * head * 0.5 },
    tip,
    { x: tip.x - dx * head + dy * head * 0.5, y: tip.y - dy * head - dx * head * 0.5 },
  ];
  return (
    <g fill="none" stroke={T.stairStroke} strokeWidth={0.02} strokeLinejoin="round">
      <path d={stair.footprint.map(rectPath).join("")} fill={T.stairFill} stroke="none" />
      {stair.treads.map((t, i) => (
        <path key={i} d={rectPath(t.rect)} strokeDasharray={t.hidden ? "0.06 0.05" : undefined} opacity={t.hidden ? 0.6 : 1} />
      ))}
      {stair.breakLine && <path d={svgLine(stair.breakLine)} strokeWidth={0.035} />}
      <path d={svgLine(stair.path)} />
      <path d={svgLine(arrow)} />
      <path d={stair.footprint.map(rectPath).join("")} strokeWidth={0.03} />
    </g>
  );
}

/** Neutral cream floors with lighter circulation and wet rooms, for drawings outside the editor. */
const WARM_FILL: Partial<Record<RoomType, string>> = { hall: "#f8f4ec", bathroom: "#ede7dc", ensuite: "#ede7dc", wc: "#ede7dc", utility: "#ede7dc" };
const WARM_DEFAULT = "#f1e9da";

/**
 * How a drawing fills its rooms: "schematic" by use (the 2D Plan's colours),
 * "zones" by the part of the day each serves, "warm" in neutral creams, and
 * "finish" with each floor as it's laid (herringbone, tiles…), as the
 * furnished plan does.
 */
export type PlanPalette = "schematic" | "warm" | "zones" | "finish";

const fillFor = (palette: Exclude<PlanPalette, "finish">, type: RoomType) =>
  palette === "warm" ? (WARM_FILL[type] ?? WARM_DEFAULT) : palette === "zones" ? zoneColour(type) : roomColour(type);

/** Finishes too fine to show in a small drawing are drawn as their colour. */
const SVG_PLAIN: ReadonlySet<FinishId> = new Set(["carpet", "concrete"]);

/** The floor finishes a drawing uses, as SVG patterns in world metres. */
function FinishDefs({ id, finishes }: { id: string; finishes: FinishId[] }) {
  return (
    <defs>
      {finishes.map((f) => {
        const tile = finishTile(f);
        const plain = SVG_PLAIN.has(f);
        return (
          <pattern key={f} id={`${id}-${f}`} patternUnits="userSpaceOnUse" width={tile.width} height={tile.height}>
            <rect width={tile.width} height={tile.height} fill={plain ? FINISH_TONE[f] : tile.base} />
            {!plain && tile.parts.map((part, i) => (part.ring ? <path key={i} d={svgLine(part.ring, true)} fill={part.fill} stroke={part.stroke} strokeWidth={part.width} /> : null))}
          </pattern>
        );
      })}
    </defs>
  );
}

/**
 * A plan's rooms, walls and (optionally) openings as SVG in world metres,
 * y up. Callers place it with their own transform.
 */
export function PlanDrawing({
  scene,
  palette = "schematic",
  detail = false,
  highlight,
  stairs,
}: {
  scene: PlanScene;
  palette?: PlanPalette;
  detail?: boolean;
  highlight?: readonly string[];
  /** The floor's stairs (see `stairsOn`). */
  stairs?: readonly StairPrimitive[];
}) {
  const id = useId().replace(/:/g, "");
  const finishes = palette === "finish" ? [...new Set(scene.rooms.map(roomFinish).filter((f): f is FinishId => !!f))] : [];
  const floorFill = (room: PlanScene["rooms"][number] | undefined): string => {
    if (!room) return WARM_DEFAULT;
    if (palette !== "finish") return fillFor(palette, room.type);
    const finish = roomFinish(room);
    return finish ? `url(#${id}-${finish})` : roomColour(room.type);
  };
  const roomsById = new Map(scene.rooms.map((r) => [r.id, r]));
  return (
    <>
      {finishes.length > 0 && <FinishDefs id={id} finishes={finishes} />}
      {scene.rooms.map((room) => (
        <path key={room.id} d={path(room.clear.flatMap((p) => [p.outer, ...p.holes]))} fill={floorFill(room)} fillRule="evenodd" />
      ))}
      {highlight?.length ? (
        <g fill={T.accentSoft} stroke={T.accent} strokeWidth={0.12}>
          {scene.rooms
            .filter((room) => highlight.includes(room.id))
            .map((room) => (
              <path key={room.id} d={path(room.clear.flatMap((p) => [p.outer, ...p.holes]))} fillRule="evenodd" />
            ))}
        </g>
      ) : null}
      {stairs?.map((stair) => <StairDrawing key={stair.id} stair={stair} />)}
      {detail && scene.rugs.length > 0 && <path d={path(scene.rugs.flatMap((p) => [p.outer, ...p.holes]))} fill={FURNITURE.rug} fillRule="evenodd" />}
      {detail && scene.furniture.length > 0 && (
        <g stroke={T.furnitureStroke} strokeWidth={0.018} strokeLinejoin="round" opacity={0.85}>
          {scene.furniture.flatMap((f) =>
            assetForItem(f.item, undefined)
              ? []
              : f.parts.map((part, i) => (
                  <path key={`${f.id}-${i}`} d={svgLine(part.ring, part.closed)} fill={part.closed && part.tone !== "none" ? FURNITURE[part.tone] : "none"} />
                )),
          )}
        </g>
      )}
      {detail && scene.furniture.map((f) => <FurniturePicture key={f.id} item={f.item} />)}
      {/* A hairline keeps thin internal walls legible at thumbnail size. */}
      <path d={path(scene.wallMass.flatMap((p) => [p.outer, ...p.holes]))} fill={T.wallFill} stroke={T.wallFill} strokeWidth={0.04} fillRule="evenodd" />
      {/* Doors and windows are gaps in the walls: the floor runs through a doorway, and a window is its frame. */}
      {scene.openings.map((o) => (
        <path key={o.id} d={path([o.cut])} fill={o.kind === "door" ? floorFill(o.floorRoomId ? roomsById.get(o.floorRoomId) : undefined) : T.frame} />
      ))}
      {detail && (
        <g fill="none" stroke={T.openingStroke} strokeWidth={0.035} strokeLinejoin="round">
          {scene.openings.map((o) =>
            o.kind === "door" ? (
              <g key={o.id}>
                {o.leaf && <path d={svgLine(o.leaf)} />}
                {o.arc && <path d={svgLine(o.arc)} strokeDasharray="0.08 0.06" />}
              </g>
            ) : (
              <g key={o.id}>
                {o.sill && <path d={path([o.sill])} fill={T.frame} />}
                {o.glazing?.map(([a, b], i) => <path key={i} d={svgLine([a, b])} stroke={T.glazing} />)}
              </g>
            ),
          )}
        </g>
      )}
    </>
  );
}

/** A small drawing of a plan's rooms and walls, derived from the same scene as the canvas. */
export const PlanThumbnail = memo(function PlanThumbnail({
  level,
  palette = "schematic",
  className = "plan-thumb",
  pad = 0.3,
  detail = false,
  highlight,
  plan,
  children,
}: {
  level: Level;
  /** The house the floor is in, to draw its stairs. */
  plan?: PlanDocument;
  /** Rooms to outline, e.g. the ones a proposal changes. */
  highlight?: readonly string[];
  /** How rooms are filled: by use ("schematic", as the 2D Plan), in cream ("warm"), by zone ("zones") or by finish ("finish"). */
  palette?: PlanPalette;
  className?: string;
  /** Margin around the house, m. */
  pad?: number;
  /** Also draw door swings, window frames and furniture (for larger drawings). */
  detail?: boolean;
  /** Drawn over the plan in world metres with y flipped (a point is at x, −y), such as room placement markers. */
  children?: ReactNode;
}) {
  const scene = buildPlanScene(level);
  const r = scene.outsideRect;
  if (!r) return <span className={className} aria-hidden />;
  const w = r.maxX - r.minX + pad * 2;
  const h = r.maxY - r.minY + pad * 2;
  return (
    <svg className={className} viewBox={`${r.minX - pad} ${-(r.maxY + pad)} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g transform="scale(1,-1)">
        <PlanDrawing scene={scene} palette={palette} detail={detail} highlight={highlight} stairs={stairsOn(plan, level)} />
      </g>
      {children}
    </svg>
  );
});
