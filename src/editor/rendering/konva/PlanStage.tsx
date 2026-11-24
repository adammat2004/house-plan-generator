"use client";

import type { Context } from "konva/lib/Context";
import type { Shape as KonvaShape } from "konva/lib/Shape";
import type { Stage as StageNode } from "konva/lib/Stage";
import { memo, useEffect, useMemo, useState } from "react";
import { Circle, Group, Image as KonvaImage, Layer, Line, Path, Rect, Shape, Stage, Text } from "react-konva";
import { deriveLevelGeometry, deriveWallMass, deriveWallMassCut } from "@/domain/geometry/derive";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { MultiPolygon, Ring } from "@/domain/geometry/polygons";
import { furnitureIssues } from "@/domain/furniture/issues";
import { levelKeepOut, staircasePlan } from "@/domain/geometry/stairs";
import { levelIndex } from "@/domain/plan/levels";
import { roomEdgeHandles } from "@/domain/design/analysis";
import { furnitureRect } from "@/domain/furniture/geometry";
import type { Level, Point2 } from "@/domain/plan/types";
import type { InteriorStyle } from "@/domain/project/schema";
import { useActiveLevel, useDocumentState, useProjectState, useSessionState } from "../../state/editor";
import { displayedDocument, inRefine, showsSchematic, type OutlineDraft, type Selection, type SnapIndicator } from "../../state/stores";
import { worldToScreen, type Viewport } from "../../viewport/viewport";
import { furnitureSymbol } from "../scene/furnitureSymbols";
import { buildDimensions, buildFacePills, buildPlanScene, openingPrimitive, type DimensionPrimitive, type FacePill, type FurniturePrimitive, type PlanScene } from "../scene/planScene";
import { buildStairScene, labelsClear, type StairPrimitive } from "../scene/stairScene";
import { GardenLayer } from "./GardenLayer";
import { buildGarden } from "../scene/garden";
import { buildableRect, sitePlot, type Site } from "@/domain/project/site";
import { registerStage } from "./stageRegistry";
import { spriteFor, useFurnitureSprites } from "./sprites";
import { FINISH_TONE, roomFinish } from "../scene/finishes";
import { finishPattern, patternDensity } from "./patterns";
import { Poly, ringsOf } from "./Poly";
import { planFurnitureFill, type FurnitureMaterial } from "../scene/style";
import { PLAN_THEME as T, loadPlanSerif } from "./theme";
import { roomColour, isUntyped } from "@/design/roomColours";
import { COLOR } from "@/design/tokens";
import { assessSense } from "@/domain/design/sense";
import { sizeText } from "@/domain/geometry/units";
import { isImperial, lengthText } from "@/components/units";

const flat = (points: Point2[]) => points.flatMap((p) => [p.x, p.y]);

/** How far furniture's shadow falls, m: to the south-east, down and right on screen. */
const FURNITURE_SHADOW = { x: 0.045, y: -0.045 };

/**
 * One piece of furniture as a single shape: a soft-edged shadow on the
 * floor, then its parts filled by what they're made of and outlined with a
 * hairline that stays the same width at every zoom.
 */
function FurnitureShape({ parts, fills, opacity = 1 }: { parts: FurniturePrimitive["parts"]; fills: Record<FurnitureMaterial, string>; opacity?: number }) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      opacity={opacity}
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        const scale = Math.abs(shape.getAbsoluteScale().x) || 1;
        // The shadow: every filled part as one path, so where parts overlap it doesn't darken twice.
        ctx.save();
        ctx.translate(FURNITURE_SHADOW.x, FURNITURE_SHADOW.y);
        ctx.beginPath();
        for (const part of parts) {
          if (!part.closed || part.tone === "none") continue;
          part.ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
        }
        ctx.setAttr("fillStyle", T.furnitureShadow);
        ctx.fill();
        ctx.restore();
        ctx.setAttr("lineWidth", 0.9 / scale);
        ctx.setAttr("strokeStyle", T.furnitureStroke);
        ctx.setAttr("lineJoin", "round");
        for (const part of parts) {
          ctx.beginPath();
          part.ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          if (part.closed) {
            ctx.closePath();
            if (part.tone !== "none") {
              ctx.setAttr("fillStyle", fills[part.tone]);
              ctx.fill();
            }
          }
          ctx.stroke();
        }
      }}
    />
  );
}

const rectRing = (r: { minX: number; minY: number; maxX: number; maxY: number }): Ring => [
  { x: r.minX, y: r.minY },
  { x: r.maxX, y: r.minY },
  { x: r.maxX, y: r.maxY },
  { x: r.minX, y: r.maxY },
];

/** Stairs as drawn on plan: treads, solid below the cut and dashed above it, the break line and the walking arrow. */
function StairShape({ stair }: { stair: StairPrimitive }) {
  const tip = stair.path[stair.path.length - 1];
  const before = stair.path[stair.path.length - 2] ?? tip;
  const len = Math.hypot(tip.x - before.x, tip.y - before.y) || 1;
  const [dx, dy] = [(tip.x - before.x) / len, (tip.y - before.y) / len];
  const head = 0.22;
  return (
    <Group listening={false}>
      <Poly rings={stair.footprint.map(rectRing)} fill={T.stairFill} />
      {stair.treads.map((t, i) => (
        <Poly key={i} rings={[rectRing(t.rect)]} stroke={T.stairStroke} strokeWidth={t.hidden ? 0.7 : 1} dash={t.hidden ? [3, 3] : undefined} />
      ))}
      {stair.breakLine && <Line points={flat(stair.breakLine)} stroke={T.stairStroke} strokeWidth={1.4} strokeScaleEnabled={false} />}
      <Line points={flat(stair.path)} stroke={T.stairStroke} strokeWidth={1} strokeScaleEnabled={false} />
      <Line
        points={flat([
          { x: tip.x - dx * head - dy * head * 0.5, y: tip.y - dy * head + dx * head * 0.5 },
          tip,
          { x: tip.x - dx * head + dy * head * 0.5, y: tip.y - dy * head - dx * head * 0.5 },
        ])}
        stroke={T.stairStroke}
        strokeWidth={1}
        strokeScaleEnabled={false}
      />
      <Poly rings={stair.footprint.map(rectRing)} stroke={T.stairStroke} strokeWidth={1.2} />
    </Group>
  );
}

/**
 * World-space plan drawing; re-rendered only when the scene changes, or when
 * the zoom crosses into a new density for the floor finishes.
 */
const PlanContent = memo(function PlanContent({
  scene,
  schematic,
  showFurniture,
  fills,
  style,
  stairs,
  underlay,
  density,
}: {
  scene: PlanScene;
  /** Rooms filled by their use, with no finishes (the 2D Plan view). */
  schematic: boolean;
  showFurniture: boolean;
  /** Furniture colours for the interior style. */
  fills: Record<FurnitureMaterial, string>;
  /** The interior style, which picks the furniture pictures. */
  style: InteriorStyle | undefined;
  /** Changes as furniture pictures arrive, so the plan redraws with them. */
  sprites: number;
  stairs: StairPrimitive[];
  /** The walls of the floor below, faded; left out of exports. */
  underlay: MultiPolygon | null;
  /** Pixels per metre to paint the floor finishes at (see patternDensity). */
  density: number;
}) {
  const floorOf = (room: PlanScene["rooms"][number] | undefined) => {
    if (schematic) return { pattern: null, fill: room ? roomColour(room.type) : T.roomFill };
    const finish = room ? roomFinish(room) : null;
    return { pattern: finish ? finishPattern(finish, density) : null, fill: room ? (finish ? FINISH_TONE[finish] : roomColour(room.type)) : T.roomFill };
  };
  const roomsById = new Map(scene.rooms.map((r) => [r.id, r]));
  return (
    <>
      {scene.rooms.map((room) => (
        <Poly key={room.id} rings={ringsOf(room.clear)} {...floorOf(room)} />
      ))}
      {/* A room with no use yet: plain paper, with a dashed edge inside its walls. */}
      {schematic &&
        scene.rooms
          .filter((room) => isUntyped(room.type))
          .map((room) => <Poly key={`untyped-${room.id}`} rings={ringsOf(room.clear)} stroke={T.untypedEdge} strokeWidth={1} dash={[5, 4]} />)}
      {underlay && (
        <Group name="transient" listening={false}>
          {/* The floor below: faded on the furnished plan, its outline only on the schematic so the colours stay clean. */}
          {schematic ? <Poly rings={ringsOf(underlay)} stroke={T.underlayLine} strokeWidth={1} /> : <Poly rings={ringsOf(underlay)} fill={T.underlay} />}
        </Group>
      )}
      {stairs.map((stair) => (
        <StairShape key={stair.id} stair={stair} />
      ))}
      {showFurniture && scene.rugs.length > 0 && <Poly rings={ringsOf(scene.rugs)} fill={fills.rug} stroke={T.rugStroke} strokeWidth={0.8} />}
      {showFurniture &&
        scene.furniture.map((f) => {
          // The library's picture of the piece from above where there is one; else its drawn symbol.
          const sprite = spriteFor(f.item, style);
          return sprite ? <KonvaImage key={f.id} name="furniture-sprite" listening={false} perfectDrawEnabled={false} {...sprite} /> : <FurnitureShape key={f.id} parts={f.parts} fills={fills} />;
        })}
      {/* The walls, with a soft shadow at their feet that lifts them off the floor. */}
      <Poly rings={ringsOf(scene.wallMass)} fill={T.wallFill} stroke={T.wallStroke} strokeWidth={1} glow={{ color: T.wallShadow, blur: 0.16 }} />
      {scene.openings.map((o) => (
        <Group key={o.id}>
          {o.kind === "door" ? (
            <>
              {/* The floor runs through the doorway. */}
              <Poly rings={[o.cut]} {...floorOf(o.floorRoomId ? roomsById.get(o.floorRoomId) : undefined)} />
              {o.sliders ? (
                o.sliders.map((panel, i) => <Poly key={i} rings={[panel]} fill={T.frame} stroke={T.openingStroke} strokeWidth={1} />)
              ) : (
                <>
                  {o.arc && <Line points={flat(o.arc)} stroke={T.swing} strokeWidth={0.9} strokeScaleEnabled={false} listening={false} />}
                  {o.panel && <Poly rings={[o.panel]} fill={T.frame} stroke={T.openingStroke} strokeWidth={1} />}
                </>
              )}
            </>
          ) : (
            <>
              {o.sill && <Poly rings={[o.sill]} fill={T.frame} stroke={T.openingStroke} strokeWidth={0.8} />}
              {o.frame && <Poly rings={[o.frame]} fill={T.frame} stroke={T.openingStroke} strokeWidth={1} />}
              {o.glazing?.map((g, i) => (
                <Line key={i} points={flat(g)} stroke={T.glazing} strokeWidth={1} strokeScaleEnabled={false} listening={false} />
              ))}
            </>
          )}
        </Group>
      ))}
    </>
  );
});

/** The terrace and the path to the street, dashed round the schematic plan. */
function SiteOutline({ garden }: { garden: NonNullable<ReturnType<typeof buildGarden>> }) {
  const outline = { stroke: T.siteOutline, strokeWidth: 1, dash: [4, 4] };
  return (
    <Group name="garden" listening={false}>
      {garden.terrace.length > 0 && <Poly rings={ringsOf(garden.terrace)} {...outline} />}
      {garden.path.length > 0 && <Poly rings={ringsOf(garden.path)} {...outline} />}
    </Group>
  );
}

/**
 * The plan paper's grid: a dot where the lines would cross, as on drawing
 * paper, every grid step while dots stay at least 14px apart, else every
 * metre, five or ten.
 */
function GridShape({ viewport, gridSize }: { viewport: Viewport; gridSize: number }) {
  return (
    <Shape
      name="grid"
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx: Context) => {
        const { scale, offsetX, offsetY, width, height } = viewport;
        const step = [gridSize, 1, 5, 10, 50].find((s) => s * scale >= 14) ?? 50;
        const x0 = Math.floor(-offsetX / scale / step) * step;
        const x1 = (width - offsetX) / scale;
        const y0 = Math.floor((offsetY - height) / scale / step) * step;
        const y1 = offsetY / scale;
        ctx.beginPath();
        for (let x = x0; x <= x1; x += step) {
          const sx = Math.round(x * scale + offsetX);
          for (let y = y0; y <= y1; y += step) {
            const sy = Math.round(-y * scale + offsetY);
            ctx.moveTo(sx + 1.2, sy);
            ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
          }
        }
        ctx.fillStyle = T.gridDot;
        ctx.fill();
      }}
    />
  );
}

/** Soft drop shadow lifting the house off the site, in screen space so it keeps its size at any zoom. */
function HouseShadow({ rect, ring, viewport }: { rect: PlanScene["outsideRect"] & object; ring: PlanScene["outsideRing"]; viewport: Viewport }) {
  const shadow = {
    fill: T.wallFill,
    shadowColor: T.houseShadow,
    shadowBlur: 22,
    shadowOffset: { x: 16, y: 18 },
    shadowOpacity: 1,
    listening: false,
    perfectDrawEnabled: false,
  };
  if (ring && ring.length > 4) {
    const points = ring.flatMap((p) => {
      const q = worldToScreen(viewport, p);
      return [q.x, q.y];
    });
    return <Line points={points} closed {...shadow} />;
  }
  const a = worldToScreen(viewport, { x: rect.minX, y: rect.maxY });
  const b = worldToScreen(viewport, { x: rect.maxX, y: rect.minY });
  return <Rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} {...shadow} />;
}

function Dimension({ dim, viewport }: { dim: DimensionPrimitive; viewport: Viewport }) {
  const a = worldToScreen(viewport, dim.a);
  const b = worldToScreen(viewport, dim.b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 24) return null;
  // World left normal mapped to screen (Y flipped).
  const wdx = dim.b.x - dim.a.x;
  const wdy = dim.b.y - dim.a.y;
  const wl = Math.hypot(wdx, wdy) || 1;
  const n = { x: -wdy / wl, y: -(wdx / wl) };
  const o = dim.offsetPx;
  const a2 = { x: a.x + n.x * o, y: a.y + n.y * o };
  const b2 = { x: b.x + n.x * o, y: b.y + n.y * o };
  const color = dim.tone === "overall" ? T.dimension : T.dimensionSelection;
  const ux = dx / len;
  const uy = dy / len;
  const tick = (p: Point2) => [p.x - (ux + n.x) * 4, p.y - (uy + n.y) * 4, p.x + (ux + n.x) * 4, p.y + (uy + n.y) * 4];
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
  // Drop the label (but keep the line) when it would not fit along the dimension.
  const showText = len >= dim.text.length * 6.2 + 16;
  const side = Math.sign(o) || 1;
  const textOffset = 13 * side;
  const ext = 4 * side;
  return (
    <Group listening={false} name={dim.tone === "selection" ? "transient" : undefined}>
      <Line points={[a.x + n.x * side * 4, a.y + n.y * side * 4, a2.x + n.x * ext, a2.y + n.y * ext]} stroke={color} strokeWidth={0.75} />
      <Line points={[b.x + n.x * side * 4, b.y + n.y * side * 4, b2.x + n.x * ext, b2.y + n.y * ext]} stroke={color} strokeWidth={0.75} />
      <Line points={[a2.x, a2.y, b2.x, b2.y]} stroke={color} strokeWidth={1} />
      <Line points={tick(a2)} stroke={color} strokeWidth={1.4} />
      <Line points={tick(b2)} stroke={color} strokeWidth={1.4} />
      {showText && dim.tone === "selection" ? (
        // What's picked: its size on a pill, as in a design tool.
        <Group x={mid.x + n.x * textOffset} y={mid.y + n.y * textOffset} rotation={angle}>
          <Rect x={-(dim.text.length * 6.4 + 14) / 2} y={-10} width={dim.text.length * 6.4 + 14} height={20} cornerRadius={6} fill={T.frame} stroke={T.accent} strokeWidth={1.2} />
          <Text width={240} offsetX={120} offsetY={6.5} align="center" text={dim.text} fontSize={11} fontFamily={T.fontFamily} fill={T.accent} fontStyle="600" />
        </Group>
      ) : showText ? (
        <Text
          x={mid.x + n.x * textOffset}
          y={mid.y + n.y * textOffset}
          width={240}
          offsetX={120}
          offsetY={6.5}
          align="center"
          rotation={angle}
          text={dim.text}
          fontSize={13}
          fontFamily={T.fontFamily}
          fill={color}
          fontStyle="500"
        />
      ) : null}
    </Group>
  );
}

/** Px from an outside face to the middle of its size pill. */
const FACE_PILL_GAP = 22;

/** An outside face's size on a white pill just outside it, turned to run along the face. */
function FacePillShape({ pill, viewport }: { pill: FacePill; viewport: Viewport }) {
  const a = worldToScreen(viewport, pill.a);
  const b = worldToScreen(viewport, pill.b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const w = pill.text.length * 6.2 + 14;
  if (len < w + 12) return null;
  // Outside is to the right of the counterclockwise face in world space; on screen (Y flipped) that's to its left.
  const n = { x: dy / len, y: -dx / len };
  let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return (
    <Group name="face-pill" x={(a.x + b.x) / 2 - n.x * FACE_PILL_GAP} y={(a.y + b.y) / 2 - n.y * FACE_PILL_GAP} rotation={angle} listening={false}>
      <Rect x={-w / 2} y={-10} width={w} height={20} cornerRadius={6} fill={T.frame} stroke={COLOR["line-strong"]} strokeWidth={1} perfectDrawEnabled={false} />
      <Text width={w} offsetX={w / 2} offsetY={6.5} align="center" text={pill.text} fontSize={11} fontStyle="500" fontFamily={T.fontFamily} fill={T.roomArea} />
    </Group>
  );
}

let measureContext: CanvasRenderingContext2D | null | undefined;
const measured = new Map<string, number>();

/** Rendered width of a room name at 15px, px: in the UI face at 600, or the plan serif. */
function labelWidth(text: string, serif = false): number {
  const key = serif ? `s|${text}` : text;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  if (measureContext === undefined) measureContext = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  let width = text.length * 8.6;
  if (measureContext) {
    measureContext.font = serif ? `15px ${T.serifFamily}` : `600 15px ${T.fontFamily}`;
    width = measureContext.measureText(text).width;
  }
  measured.set(key, width);
  return width;
}

/**
 * True once web fonts have loaded. Canvas text is drawn with whatever font is
 * available at the time, so labels are measured and drawn again when Inter
 * and the plan serif arrive. The serif is used only on the canvas, so
 * `document.fonts.ready` alone would never load it: ask for it by name.
 */
function useFontsReady(): boolean {
  const [ready, setReady] = useState(() => typeof document === "undefined" || !document.fonts);
  useEffect(() => {
    if (ready) return;
    let live = true;
    void Promise.all([document.fonts.ready, loadPlanSerif()]).then(() => {
      if (!live) return;
      measured.clear();
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}

const NO_FLAGS: ReadonlySet<string> = new Set();

/** The pin from the room card's icon, on its 24-unit grid. */
const PIN_PATH = "M9 3.5h6l-1 5.5 3 3V14H7v-2l3-3z M12 14v6.5";

/** Lines a name wraps to at a font size, by measured word widths (greedy, like the canvas wrap). */
function wrapLines(name: string, boxW: number, fontSize: number, serif = false): number | null {
  const k = fontSize / 15;
  const space = labelWidth(" ", serif) * k;
  let lines = 1;
  let used = 0;
  for (const word of name.split(/\s+/)) {
    const w = labelWidth(word, serif) * k;
    if (w + 4 > boxW) return null;
    if (used && used + space + w + 4 > boxW) {
      lines += 1;
      used = w;
    } else used = used ? used + space + w : w;
  }
  return lines;
}

/**
 * How a room's name fits its box: the largest size (14 or 12px) that fits on
 * at most two lines, else one shortened line. Null when the room is too
 * small to label; the plan contents list always has every name.
 */
function fitLabel(name: string, boxW: number, heightPx: number, serif = false): { fontSize: number; lines: number; ellipsis: boolean } | null {
  for (const fontSize of serif ? [15, 13] : [14, 12]) {
    const lines = wrapLines(name, boxW, fontSize, serif);
    if (lines !== null && lines <= 2 && heightPx >= fontSize * 1.15 * lines + 8) return { fontSize, lines, ellipsis: false };
  }
  return boxW >= 44 && heightPx >= 24 ? { fontSize: 12, lines: 1, ellipsis: true } : null;
}

/** Rendered width of an area label at 11px, px. */
const areaWidth = (text: string) => labelWidth(text) * (11 / 15) * 0.92;

function RoomLabels({ scene, viewport, selection }: { scene: PlanScene; viewport: Viewport; selection: Selection }) {
  return (
    <>
      {scene.rooms.map((room) => {
        const widthPx = (room.bounds.maxX - room.bounds.minX) * viewport.scale;
        const heightPx = (room.bounds.maxY - room.bounds.minY) * viewport.scale;
        const boxW = Math.min(widthPx - 16, 190);
        const fit = fitLabel(room.name, boxW, heightPx);
        if (!fit) return null;
        const p = worldToScreen(viewport, room.label);
        const lineH = Math.round(fit.fontSize * 1.15);
        const nameH = lineH * fit.lines;
        // The area goes under the name only when both fit inside the room.
        const showArea = !fit.ellipsis && heightPx >= nameH + 14 + 20 && widthPx >= 64;
        const selected = selection?.kind === "room" && selection.id === room.id;
        const nameTop = showArea ? -(nameH + 1) : -nameH / 2;
        const nameWidth = Math.min(labelWidth(room.name) * (fit.fontSize / 15), boxW);
        // A soft pill behind the words, so they read over any floor or furniture.
        const pillW = Math.min(Math.max(fit.lines > 1 ? boxW : nameWidth, showArea ? areaWidth(room.areaLabel) : 0) + 16, boxW + 16) + (room.pinned ? 14 : 0);
        const pillTop = nameTop - 5;
        const pillH = nameH + (showArea ? 14 : 0) + 9;
        return (
          <Group key={room.id} x={p.x} y={p.y} listening={false}>
            <Rect
              x={-pillW / 2 - (room.pinned ? 0 : 0)}
              y={pillTop}
              width={pillW}
              height={pillH}
              cornerRadius={7}
              fill={T.labelPill}
              stroke={selected ? T.accent : undefined}
              strokeWidth={selected ? 1.5 : 0}
              perfectDrawEnabled={false}
            />
            {room.pinned && (
              <Path
                name="room-pin"
                data={PIN_PATH}
                x={(fit.lines > 1 ? boxW : nameWidth) / 2 + 3}
                y={nameTop + 2}
                scaleX={0.55}
                scaleY={0.55}
                fill={selected ? T.accent : T.roomLabel}
                stroke={selected ? T.accent : T.roomLabel}
                strokeWidth={2.6}
                lineCap="round"
                lineJoin="round"
              />
            )}
            <Text
              text={room.name}
              width={boxW}
              height={fit.ellipsis ? lineH : undefined}
              offsetX={boxW / 2}
              y={nameTop}
              align="center"
              fontSize={fit.fontSize}
              lineHeight={1.15}
              fontStyle="600"
              fontFamily={T.fontFamily}
              fill={T.roomLabel}
              wrap={fit.lines > 1 ? "word" : "none"}
              ellipsis={fit.ellipsis}
            />
            {showArea && (
              <Text
                text={room.areaLabel}
                width={boxW}
                offsetX={boxW / 2}
                y={2}
                align="center"
                fontSize={11}
                fontFamily={T.fontFamily}
                fill={T.roomArea}
                wrap="none"
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

/** Rooms smaller than this show their name only, m². */
const NAME_ONLY_AREA = 3;

/** "3.60 × 6.53 m" for a plain rectangle of floor; else its area. */
function roomSize(room: PlanScene["rooms"][number]): string {
  const [only, ...more] = room.clear;
  if (only && !more.length && !only.holes.length && only.outer.length === 4) {
    const xs = new Set(only.outer.map((p) => p.x.toFixed(3)));
    const ys = new Set(only.outer.map((p) => p.y.toFixed(3)));
    if (xs.size === 2 && ys.size === 2) return sizeText(room.bounds.maxX - room.bounds.minX, room.bounds.maxY - room.bounds.minY, { imperial: isImperial() });
  }
  return room.areaLabel;
}

/**
 * Room names on the schematic plan, drawn like an architect's: the name in
 * the plan serif with the room's size underneath, straight on the floor with
 * no pill. A halo in the room's own colour keeps the words clear where they
 * cross a line. A pinned room has a pin before its name; a room with
 * something to check has a small warning dot after it.
 */
function SchematicLabels({ scene, viewport, flagged }: { scene: PlanScene; viewport: Viewport; flagged: ReadonlySet<string> }) {
  return (
    <>
      {scene.rooms.map((room) => {
        const widthPx = (room.bounds.maxX - room.bounds.minX) * viewport.scale;
        const heightPx = (room.bounds.maxY - room.bounds.minY) * viewport.scale;
        const boxW = Math.min(widthPx - 16, 200);
        const fit = fitLabel(room.name, boxW, heightPx, true);
        if (!fit) return null;
        const p = worldToScreen(viewport, room.label);
        const lineH = Math.round(fit.fontSize * 1.15);
        const nameH = lineH * fit.lines;
        const size = roomSize(room);
        const showSize = !fit.ellipsis && room.clearArea >= NAME_ONLY_AREA && heightPx >= nameH + 14 + 16 && widthPx >= 64;
        const nameTop = showSize ? -(nameH + 1) : -nameH / 2;
        const nameWidth = Math.min(labelWidth(room.name, true) * (fit.fontSize / 15), boxW);
        const halo = { stroke: roomColour(room.type), strokeWidth: 4, fillAfterStrokeEnabled: true, lineJoin: "round" as const };
        const firstLineW = fit.lines > 1 ? boxW : nameWidth;
        return (
          <Group key={room.id} x={p.x} y={p.y} listening={false}>
            {room.pinned && (
              <Path
                name="room-pin"
                data={PIN_PATH}
                x={-firstLineW / 2 - 14}
                y={nameTop + 1}
                scaleX={0.55}
                scaleY={0.55}
                fill={T.roomLabel}
                stroke={T.roomLabel}
                strokeWidth={2.6}
                lineCap="round"
                lineJoin="round"
              />
            )}
            <Text
              text={room.name}
              width={boxW}
              height={fit.ellipsis ? lineH : undefined}
              offsetX={boxW / 2}
              y={nameTop}
              align="center"
              fontSize={fit.fontSize}
              lineHeight={1.15}
              fontFamily={T.serifFamily}
              fill={T.roomLabel}
              wrap={fit.lines > 1 ? "word" : "none"}
              ellipsis={fit.ellipsis}
              {...halo}
            />
            {flagged.has(room.id) && <Circle name="room-check" x={firstLineW / 2 + 7} y={nameTop + lineH / 2} radius={3.5} fill={COLOR.warning} />}
            {showSize && (
              <Text text={size} width={boxW} offsetX={boxW / 2} y={3} align="center" fontSize={11} fontStyle="500" fontFamily={T.fontFamily} fill={T.roomArea} wrap="none" {...halo} />
            )}
          </Group>
        );
      })}
    </>
  );
}

/**
 * Which way the house faces: GARDEN beside the rear wall and STREET on the
 * opposite side. Plain annotations, like a drawing's, not part of the plan.
 */
function SideMarkers({ level, viewport, house }: { level: Level; viewport: Viewport; house: PlanScene["outsideRect"] }) {
  if (!level.rearWallId || !house) return null;
  const axis = deriveLevelGeometry(level).axes.get(level.rearWallId);
  if (!axis) return null;
  // Exterior is to the right of the counterclockwise envelope walls.
  const out = { x: -axis.normal.x, y: -axis.normal.y };
  // Past the size pills on the outside faces: at least 52px out at any zoom.
  const gap = Math.max(0.9, 52 / viewport.scale);
  const garden = worldToScreen(viewport, {
    x: (axis.start.x + axis.end.x) / 2 + out.x * (axis.wall.thickness / 2 + gap),
    y: (axis.start.y + axis.end.y) / 2 + out.y * (axis.wall.thickness / 2 + gap),
  });
  const cx = (house.minX + house.maxX) / 2;
  const cy = (house.minY + house.maxY) / 2;
  const reach = Math.abs(out.x) * (house.maxX - house.minX) / 2 + Math.abs(out.y) * (house.maxY - house.minY) / 2;
  const street = worldToScreen(viewport, { x: cx - out.x * (reach + gap), y: cy - out.y * (reach + gap) });
  const s = worldToScreen(viewport, axis.start);
  const e = worldToScreen(viewport, axis.end);
  let angle = (Math.atan2(e.y - s.y, e.x - s.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  const label = (p: { x: number; y: number }, text: string) => (
    <Text x={p.x} y={p.y} width={140} offsetX={70} offsetY={7} align="center" rotation={angle} text={text} fontSize={12} fontStyle="600" letterSpacing={1.6} fontFamily={T.fontFamily} fill={T.annotation} />
  );
  return (
    <Group listening={false}>
      {label(garden, "GARDEN")}
      {label(street, "STREET")}
    </Group>
  );
}

/** The site on Map: the plot's size along two edges, and where the house may go, dashed. */
function SiteOverlay({ level, site, viewport }: { level: Level; site: Site | undefined; viewport: Viewport }) {
  const env = analyzeEnvelope(level);
  if (!env.ok || !site) return null;
  const rear = (level.rearWallId && env.info.sideOfWall[level.rearWallId]) || "north";
  const plot = sitePlot(env.info.outsideRect, rear, site);
  if (!plot) return null;
  const b = buildableRect(plot, rear, site.setbacks);
  const corners = [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.maxX, y: b.maxY },
    { x: b.minX, y: b.maxY },
  ].map((p) => worldToScreen(viewport, p));
  const dims: DimensionPrimitive[] = [
    // Along the south edge and up the east edge, outside the plot.
    { key: "plot-width", a: { x: plot.minX, y: plot.minY }, b: { x: plot.maxX, y: plot.minY }, offsetPx: -18, text: lengthText(plot.maxX - plot.minX, 1), tone: "overall" },
    { key: "plot-depth", a: { x: plot.maxX, y: plot.minY }, b: { x: plot.maxX, y: plot.maxY }, offsetPx: -18, text: lengthText(plot.maxY - plot.minY, 1), tone: "overall" },
  ];
  return (
    <Group listening={false}>
      {b.maxX > b.minX && b.maxY > b.minY && <Line points={corners.flatMap((p) => [p.x, p.y])} closed stroke={T.accent} strokeWidth={1.5} dash={[7, 5]} listening={false} />}
      {dims.map((dim) => (
        <Dimension key={dim.key} dim={dim} viewport={viewport} />
      ))}
    </Group>
  );
}

/** Which way north is, beside the house's south-east corner, once the site says. Part of plan images. */
function Compass({ north, house, viewport }: { north: number; house: NonNullable<PlanScene["outsideRect"]>; viewport: Viewport }) {
  const corner = worldToScreen(viewport, { x: house.maxX, y: house.minY });
  const rad = (north * Math.PI) / 180;
  return (
    <Group x={corner.x + 48} y={corner.y + 44} listening={false}>
      <Circle radius={17} fill={T.frame} stroke={T.dimension} strokeWidth={1} listening={false} />
      <Group rotation={north} listening={false}>
        <Line points={[0, -13, 4.5, 2, 0, -1, -4.5, 2]} closed fill={T.roomLabel} listening={false} />
        <Line points={[0, 13, 4.5, 2, 0, -1, -4.5, 2]} closed fill={T.frame} stroke={T.dimension} strokeWidth={0.8} listening={false} />
      </Group>
      <Text x={Math.sin(rad) * 27} y={-Math.cos(rad) * 27} width={20} offsetX={10} offsetY={6} align="center" text="N" fontSize={12} fontStyle="600" fontFamily={T.fontFamily} fill={T.roomLabel} listening={false} />
    </Group>
  );
}

function SnapMarker({ snap, viewport }: { snap: SnapIndicator; viewport: Viewport }) {
  const p = worldToScreen(viewport, snap.point);
  const common = { stroke: T.accent, strokeWidth: 1.5, listening: false } as const;
  switch (snap.kind) {
    case "endpoint":
      return <Rect x={p.x - 5} y={p.y - 5} width={10} height={10} fill="white" {...common} />;
    case "junction":
      return <Rect x={p.x} y={p.y - 7} width={10} height={10} rotation={45} fill="white" {...common} />;
    case "wall":
      return <Circle x={p.x} y={p.y} radius={5} fill="white" {...common} />;
    case "centre":
      return (
        <Group listening={false}>
          <Circle x={p.x} y={p.y} radius={7} fill="white" {...common} />
          <Circle x={p.x} y={p.y} radius={2} fill={T.accent} listening={false} />
        </Group>
      );
    case "grid":
      return <Line points={[p.x - 5, p.y, p.x + 5, p.y, p.x, p.y, p.x, p.y - 5, p.x, p.y + 5]} {...common} />;
    default:
      return <Circle x={p.x} y={p.y} radius={2} fill={T.accent} listening={false} />;
  }
}

function SelectionOverlay({
  level,
  scene,
  selection,
  hover,
  issueIds,
  schematic,
  erased,
}: {
  level: Level;
  scene: PlanScene;
  selection: Selection;
  hover: Selection;
  issueIds: string[];
  schematic: boolean;
  erased: readonly string[];
}) {
  const outline = (s: Selection, color: string, width: number, fill?: string) => {
    if (!s) return null;
    if (s.kind === "wall") {
      const axis = scene.axes.find((a) => a.wallId === s.id);
      return axis ? <Poly rings={[axis.footprint]} stroke={color} strokeWidth={width} fill={fill} /> : null;
    }
    if (s.kind === "opening") {
      const o = scene.openings.find((x) => x.id === s.id);
      return o ? <Poly rings={[o.cut]} stroke={color} strokeWidth={width} fill={fill} /> : null;
    }
    if (s.kind === "furniture") {
      const f = scene.furniture.find((x) => x.id === s.id);
      return f ? <Poly rings={[f.outline]} stroke={color} strokeWidth={width} fill={fill} /> : null;
    }
    const room = scene.rooms.find((r) => r.id === s.id);
    return room ? <Poly rings={ringsOf(room.clear)} stroke={color} strokeWidth={width} fill={fill} /> : null;
  };
  const issues = issueIds
    .map((id) =>
      level.walls[id]
        ? { kind: "wall" as const, id }
        : level.openings[id]
          ? { kind: "opening" as const, id }
          : level.furniture[id]
            ? { kind: "furniture" as const, id }
            : // A pinned room that refused an edit.
              level.rooms[id]
              ? { kind: "room" as const, id }
              : null,
    )
    .filter(Boolean) as Selection[];
  return (
    <>
      {hover && (hover.kind !== selection?.kind || hover.id !== selection?.id) && outline(hover, T.hover, 1.5, schematic && hover.kind === "room" ? T.hoverWash : undefined)}
      {outline(selection, T.accent, schematic && selection?.kind === "room" ? 2.5 : 2, T.accentSoft)}
      {issues.map((s) => s && <Group key={`issue-${s.id}`}>{outline(s, T.error, 2, T.errorSoft)}</Group>)}
      {/* Rooms brushed with Erase: washed out, waiting to be laid out again. */}
      {erased.map((id) => (
        <Group key={`erased-${id}`}>{outline({ kind: "room", id }, T.error, 2, T.erased)}</Group>
      ))}
    </>
  );
}

function LengthPill({ at, text, tone }: { at: Point2; text: string; tone: "accent" | "error" }) {
  const w = text.length * 6.6 + 16;
  return (
    <Group x={at.x + 10} y={at.y - 28} listening={false} name="transient">
      <Rect width={w} height={20} cornerRadius={10} fill={tone === "accent" ? T.accent : T.error} />
      <Text width={w} height={20} align="center" verticalAlign="middle" text={text} fontSize={11} fontStyle="600" fontFamily={T.fontFamily} fill="white" />
    </Group>
  );
}

/** The outline being drawn: corners so far, the next wall to the cursor, and a dashed line closing it. */
function OutlineDraftShape({ draft, viewport }: { draft: OutlineDraft; viewport: Viewport }) {
  const corners = draft.cursor ? [...draft.points, draft.cursor] : draft.points;
  const screen = corners.map((p) => worldToScreen(viewport, p));
  const colour = draft.problem ? T.error : T.accent;
  const first = screen[0];
  const last = screen[screen.length - 1];
  const lastWall = draft.cursor && draft.points.length ? Math.hypot(draft.cursor.x - draft.points[draft.points.length - 1].x, draft.cursor.y - draft.points[draft.points.length - 1].y) : 0;
  return (
    <Group name="transient" listening={false}>
      <Line points={screen.flatMap((p) => [p.x, p.y])} stroke={colour} strokeWidth={3} lineJoin="round" />
      {screen.length > 2 && <Line points={[last.x, last.y, first.x, first.y]} stroke={colour} strokeWidth={1.5} dash={[6, 5]} opacity={0.7} />}
      {screen.map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={i === 0 ? 6 : 4} fill="white" stroke={colour} strokeWidth={2} />
      ))}
      {lastWall > 0 && <LengthPill at={last} text={lengthText(lastWall, 2)} tone={draft.problem ? "error" : "accent"} />}
    </Group>
  );
}

/** UP and DOWN beside each staircase, in screen space so they read at any zoom. */
function StairLabels({ stairs, viewport }: { stairs: StairPrimitive[]; viewport: Viewport }) {
  if (!stairs.length || viewport.scale < 12) return null;
  return (
    <Group listening={false}>
      {stairs.flatMap((stair) =>
        stair.labels.map((label) => {
          // Just past the end of the flight, on the floor stepped onto: the text's box touches the end's middle.
          const p = worldToScreen(viewport, label.at);
          const away = { x: label.away.x, y: -label.away.y };
          const half = { x: (label.text.length * 8 + 4) / 2 + 4, y: 6 + 4 };
          const t = Math.min(Math.abs(away.x) > 1e-6 ? half.x / Math.abs(away.x) : Infinity, Math.abs(away.y) > 1e-6 ? half.y / Math.abs(away.y) : Infinity);
          return (
            <Text
              key={`${stair.id}-${label.text}`}
              x={p.x + away.x * t - 30}
              y={p.y + away.y * t - 6}
              width={60}
              align="center"
              text={label.text}
              fontFamily={T.fontFamily}
              fontSize={10}
              fontStyle="600"
              letterSpacing={1}
              fill={T.annotation}
            />
          );
        }),
      )}
    </Group>
  );
}

/** How an export draws the plan, whatever the view on screen: rooms by use, or with finishes, furniture and garden. */
export type PlanLook = "schematic" | "furnished";

export function PlanStage({ width, height, look, onStage }: { width: number; height: number; look?: PlanLook; onStage?: (stage: StageNode | null) => void }) {
  const doc = useDocumentState(displayedDocument);
  const notice = useDocumentState((s) => s.notice);
  const previewIssue = useDocumentState((s) => s.preview?.issue ?? null);
  const viewport = useSessionState((s) => s.viewport);
  const selection = useSessionState((s) => s.selection);
  const hover = useSessionState((s) => s.hover);
  const erased = useSessionState((s) => s.erased);
  const cameraEye = useSessionState((s) => s.cameraPick?.eye ?? null);
  const cursor = useSessionState((s) => (s.cameraPick?.eye ? s.cursor : null));
  const snap = useSessionState((s) => s.snap);
  const wallDraft = useSessionState((s) => s.wallDraft);
  const outlineDraft = useSessionState((s) => s.outlineDraft);
  const openingDraft = useSessionState((s) => s.openingDraft);
  const settings = useSessionState((s) => s.settings);
  const tool = useSessionState((s) => s.tool);
  const refining = useSessionState(inRefine);
  // An option on show: its changed rooms picked out, and the walls as they are now as a dashed ghost.
  const staged = useDocumentState((s) => (s.staged && !s.staged.peek && s.staged.source === s.history.present ? s.staged : null));
  const furnishedView = useSessionState((s) => s.view === "furnished");
  const schematicView = useSessionState(showsSchematic);
  // An export asks for its own look; otherwise the plan is drawn as the view on screen says.
  const furnished = look ? look === "furnished" : furnishedView;
  const schematic = look ? look === "schematic" : schematicView;
  const drag = useSessionState((s) => s.drag);
  // Re-renders (and re-measures labels) once the UI font has loaded.
  useFontsReady();

  const level = useActiveLevel(true);
  const index = levelIndex(doc, level.id);
  const below = index > 0 ? doc.levels[index - 1] : null;
  const above = doc.levels[index + 1] ?? null;
  const underlay = useMemo(() => (below ? deriveWallMass(below) : null), [below]);
  const aboveRing = useMemo(() => {
    const env = above ? analyzeEnvelope(above) : null;
    return env?.ok ? env.info.outsideRing : null;
  }, [above]);
  const stairs = useMemo(() => buildStairScene(doc, level.id), [doc, level.id]);
  const scene = useMemo(() => buildPlanScene(level), [level]);
  const interiorStyle = useProjectState((s) => s.appearance?.interiorStyle);
  const furnitureItems = useMemo(() => Object.values(level.furniture), [level.furniture]);
  const sprites = useFurnitureSprites(furnitureItems, interiorStyle, furnished || !refining);
  // The garden and the house's shadow go round the ground floor, which holds every floor above.
  const groundScene = buildPlanScene(doc.levels[0]);
  const site = useProjectState((s) => s.site);
  const mapping = useSessionState((s) => s.workspace === "site");
  const garden = buildGarden(doc.levels[0], site);
  const furnitureProblems = furnitureIssues(level, levelKeepOut(doc, level.id));
  const stairsDraft = useSessionState((s) => s.stairsDraft);
  const draftStairs = stairsDraft ? staircasePlan(doc, stairsDraft.staircase) : null;
  const stairsOf = (s: Selection) => (s?.kind === "stairs" ? stairs.find((p) => p.id === s.id)?.footprint : undefined);
  const selectedStairs = stairsOf(selection);
  const hoveredStairs = hover?.id !== selection?.id ? stairsOf(hover) : undefined;
  // On screen the house's size is a pill on each outside face; the overall lines are for exports.
  const dims = useMemo(() => buildDimensions(level, selection).filter((d) => d.tone !== "overall"), [level, selection]);
  const facePills = useMemo(() => buildFacePills(level), [level]);
  // Rooms with something to check get a dot beside their name on the schematic plan.
  const flagged = useMemo(() => (schematic ? new Set(assessSense(level).findings.flatMap((f) => f.roomIds)) : NO_FLAGS), [schematic, level]);
  const geometry = deriveLevelGeometry(level);
  const issueIds = previewIssue?.entityIds ?? (notice?.tone === "error" ? notice.entityIds : []);

  const selectedAxis = selection?.kind === "wall" ? geometry.axes.get(selection.id) : undefined;
  const editable = tool === "select" && refining;
  const showHandles = editable && selectedAxis && selectedAxis.wall.role === "internal";
  // The outline is reshaped from its corners and by dragging its walls.
  const outlineSelected = editable && (selection?.kind === "house" || selectedAxis?.wall.role === "external");
  const outlineEnv = outlineSelected ? analyzeEnvelope(level) : null;
  const cornerHandles = outlineEnv?.ok ? outlineEnv.info.axisRing.map((p) => worldToScreen(viewport, p)) : [];
  const grabBar =
    editable && selectedAxis?.wall.role === "external"
      ? { p: worldToScreen(viewport, { x: (selectedAxis.start.x + selectedAxis.end.x) / 2, y: (selectedAxis.start.y + selectedAxis.end.y) / 2 }), rotation: selectedAxis.orientation === "vertical" ? 90 : 0 }
      : null;
  // Grips on the picked room's sides that a single wall makes, and on the picked piece's corners.
  const roomGrips = editable && selection?.kind === "room" && level.rooms[selection.id] ? roomEdgeHandles(level, selection.id) : [];
  const pickedPiece = editable && furnished && selection?.kind === "furniture" ? level.furniture[selection.id] : undefined;
  const pieceRect = pickedPiece ? furnitureRect(pickedPiece) : null;
  const pieceCorners = pieceRect
    ? [
        { x: pieceRect.minX, y: pieceRect.minY },
        { x: pieceRect.maxX, y: pieceRect.minY },
        { x: pieceRect.maxX, y: pieceRect.maxY },
        { x: pieceRect.minX, y: pieceRect.maxY },
      ].map((p) => worldToScreen(viewport, p))
    : [];
  const guides = useSessionState((s) => s.guides);
  const selectedOpening = editable && selection?.kind === "opening" ? level.openings[selection.id] : undefined;
  const openingAxis = selectedOpening ? geometry.axes.get(selectedOpening.wallId) : undefined;
  const openingHandles =
    selectedOpening && openingAxis
      ? [selectedOpening.offset, selectedOpening.offset + selectedOpening.width].map((s) => {
          const p = worldToScreen(viewport, { x: openingAxis.start.x + openingAxis.dir.x * s, y: openingAxis.start.y + openingAxis.dir.y * s });
          // Handles sit across the wall, so rotate with it on screen.
          return { p, rotation: openingAxis.orientation === "vertical" ? 90 : 0 };
        })
      : [];

  const draftOpening = (() => {
    if (!openingDraft) return null;
    const axis = geometry.axes.get(openingDraft.wallId);
    if (!axis) return null;
    return openingPrimitive({ id: "draft", kind: openingDraft.kind, wallId: openingDraft.wallId, offset: openingDraft.offset, width: openingDraft.width }, axis);
  })();

  const draftRect = (() => {
    if (!wallDraft) return null;
    const { start, end } = wallDraft;
    const half = settings.internalThickness / 2;
    if (Math.abs(end.x - start.x) < 1e-9 && Math.abs(end.y - start.y) < 1e-9) return null;
    const horizontal = Math.abs(end.y - start.y) < 1e-9;
    const ring: Ring = horizontal
      ? [
          { x: start.x, y: start.y - half },
          { x: end.x, y: end.y - half },
          { x: end.x, y: end.y + half },
          { x: start.x, y: start.y + half },
        ]
      : [
          { x: start.x - half, y: start.y },
          { x: end.x - half, y: end.y },
          { x: end.x + half, y: end.y },
          { x: start.x + half, y: start.y },
        ];
    return { ring, length: Math.hypot(end.x - start.x, end.y - start.y) };
  })();

  // Refine's plan view leaves the furniture out so the layout stays the focus; the furnished view shows it, and its problems.
  const showFurniture = look ? look === "furnished" : furnished || !refining;
  const showProblems = furnished && refining;
  const furnitureDraft = useSessionState((s) => s.furnitureDraft);
  const draftSymbol = furnitureDraft ? furnitureSymbol(furnitureDraft.item) : null;
  const fills = useMemo(() => planFurnitureFill(interiorStyle), [interiorStyle]);
  const ghostLevel = staged ? staged.source.levels.find((l) => l.id === level.id) : undefined;
  const ghost = useMemo(() => (ghostLevel ? deriveWallMassCut(ghostLevel) : null), [ghostLevel]);
  const changedRooms = staged ? scene.rooms.filter((r) => staged.roomIds.includes(r.id)) : [];

  const transform = { x: viewport.offsetX, y: viewport.offsetY, scaleX: viewport.scale, scaleY: -viewport.scale };
  const density = patternDensity(viewport.scale, typeof window === "undefined" ? 1 : window.devicePixelRatio);

  return (
    <Stage width={width} height={height} listening={false} ref={onStage ?? registerStage}>
      <Layer listening={false}>
        <Rect name="paper" x={0} y={0} width={width} height={height} fill={T.paper} />
        {settings.gridVisible && <GridShape viewport={viewport} gridSize={settings.gridSize} />}
        {groundScene.outsideRect && (
          <>
            <Group {...transform}>
              {/* The schematic plan sits on paper: only the terrace and the path, dashed. The garden is for the furnished plan. */}
              {garden && (schematic ? <SiteOutline garden={garden} /> : <GardenLayer garden={garden} density={density} />)}
            </Group>
            <HouseShadow rect={groundScene.outsideRect} ring={groundScene.outsideRing} viewport={viewport} />
          </>
        )}
      </Layer>
      <Layer listening={false}>
        <Group {...transform}>
          <PlanContent scene={scene} schematic={schematic} showFurniture={showFurniture} fills={fills} style={interiorStyle} sprites={sprites} stairs={stairs} underlay={underlay} density={density} />
        </Group>
      </Layer>
      <Layer listening={false}>
        <Group {...transform} name="transient">
          {aboveRing && <Poly rings={[aboveRing]} stroke={T.floorAbove} strokeWidth={1.2} dash={[8, 5]} />}
          {changedRooms.map((r) => (
            <Poly key={`changed-${r.id}`} rings={ringsOf(r.clear)} fill={T.accentSoft} stroke={T.accent} strokeWidth={2} />
          ))}
          {ghost && <Poly rings={ringsOf(ghost)} stroke={T.ghost} strokeWidth={1.2} dash={[6, 4]} />}
          {selectedStairs && <Poly rings={selectedStairs.map(rectRing)} stroke={T.accent} strokeWidth={2.5} fill={T.accentSoft} />}
          {hoveredStairs && <Poly rings={hoveredStairs.map(rectRing)} stroke={T.hover} strokeWidth={2} />}
          {draftStairs && stairsDraft && (
            <>
              <Poly rings={draftStairs.footprint.map(rectRing)} fill={stairsDraft.valid ? T.validSoft : T.errorSoft} stroke={stairsDraft.valid ? T.valid : T.error} strokeWidth={1.5} />
              {draftStairs.treads.map((t, i) => (
                <Poly key={i} rings={[rectRing(t.rect)]} stroke={stairsDraft.valid ? T.valid : T.error} strokeWidth={0.8} />
              ))}
              <Line points={flat(draftStairs.path)} stroke={stairsDraft.valid ? T.valid : T.error} strokeWidth={1} strokeScaleEnabled={false} />
            </>
          )}
          {showProblems &&
            scene.furniture
              .filter((f) => furnitureProblems.has(f.id))
              .map((f) => <Poly key={`problem-${f.id}`} rings={[f.outline]} stroke={T.error} strokeWidth={1.5} dash={[5, 3]} fill={T.errorSoft} />)}
          <SelectionOverlay level={level} scene={scene} selection={selection} hover={hover} issueIds={issueIds} schematic={schematic} erased={erased} />
          {/* A camera being put down: where it stands, and a line to what it will look at. */}
          {cameraEye && (
            <>
              {cursor && <Line points={flat([cameraEye, cursor])} stroke={T.accent} strokeWidth={1.5} dash={[6, 4]} strokeScaleEnabled={false} />}
              <Poly
                rings={[
                  [
                    { x: cameraEye.x - 0.18, y: cameraEye.y - 0.18 },
                    { x: cameraEye.x + 0.18, y: cameraEye.y - 0.18 },
                    { x: cameraEye.x + 0.18, y: cameraEye.y + 0.18 },
                    { x: cameraEye.x - 0.18, y: cameraEye.y + 0.18 },
                  ],
                ]}
                stroke={T.accent}
                strokeWidth={2}
                fill={T.accentSoft}
              />
            </>
          )}
          {draftSymbol && (
            <>
              <FurnitureShape parts={draftSymbol.parts} fills={fills} opacity={0.75} />
              <Poly rings={[draftSymbol.outline]} stroke={furnitureDraft?.clear ? T.valid : T.error} strokeWidth={1.5} fill={furnitureDraft?.clear ? T.validSoft : T.errorSoft} />
            </>
          )}
          {draftRect && (
            <Poly rings={[draftRect.ring]} fill={wallDraft?.valid ? T.validSoft : T.errorSoft} stroke={wallDraft?.valid ? T.valid : T.error} strokeWidth={1.5} />
          )}
          {draftOpening && (
            <Poly rings={[draftOpening.cut]} fill={openingDraft?.valid ? T.validSoft : T.errorSoft} stroke={openingDraft?.valid ? T.valid : T.error} strokeWidth={2} />
          )}
          {draftOpening?.arc && <Line points={flat(draftOpening.arc)} stroke={openingDraft?.valid ? T.valid : T.error} strokeWidth={1} dash={[4, 3]} strokeScaleEnabled={false} />}
        </Group>
        <SideMarkers level={level} viewport={viewport} house={scene.outsideRect} />
        {mapping && <SiteOverlay level={doc.levels[0]} site={site} viewport={viewport} />}
        {site?.north !== undefined && groundScene.outsideRect && <Compass north={site.north} house={groundScene.outsideRect} viewport={viewport} />}
        {schematic ? (
          <SchematicLabels scene={labelsClear(scene, stairs)} viewport={viewport} flagged={flagged} />
        ) : (
          <RoomLabels scene={labelsClear(scene, stairs)} viewport={viewport} selection={selection} />
        )}
        <StairLabels stairs={stairs} viewport={viewport} />
        {facePills.map((pill) => (
          <FacePillShape key={pill.key} pill={pill} viewport={viewport} />
        ))}
        {dims.map((dim) => (
          <Dimension key={dim.key} dim={dim} viewport={viewport} />
        ))}
        {draftRect && wallDraft && (
          <LengthPill
            at={worldToScreen(viewport, { x: (wallDraft.start.x + wallDraft.end.x) / 2, y: (wallDraft.start.y + wallDraft.end.y) / 2 })}
            text={lengthText(draftRect.length, 3)}
            tone={wallDraft.valid ? "accent" : "error"}
          />
        )}
        {drag === "drag-end" && selectedAxis && (
          <LengthPill
            at={worldToScreen(viewport, { x: (selectedAxis.start.x + selectedAxis.end.x) / 2, y: (selectedAxis.start.y + selectedAxis.end.y) / 2 })}
            text={lengthText(selectedAxis.length, 3)}
            tone={previewIssue ? "error" : "accent"}
          />
        )}
        {outlineDraft && <OutlineDraftShape draft={outlineDraft} viewport={viewport} />}
        <Group name="transient" listening={false}>
          {showHandles &&
            selectedAxis &&
            [selectedAxis.start, selectedAxis.end].map((p, i) => {
              const s = worldToScreen(viewport, p);
              return <Circle key={i} x={s.x} y={s.y} radius={6.5} fill="white" stroke={T.accent} strokeWidth={2} shadowColor="rgba(0,0,0,0.18)" shadowBlur={3} shadowOffsetY={1} />;
            })}
          {cornerHandles.map((p, i) => (
            <Rect key={`corner-${i}`} x={p.x} y={p.y} width={9} height={9} offsetX={4.5} offsetY={4.5} fill="white" stroke={T.accent} strokeWidth={2} shadowColor="rgba(0,0,0,0.18)" shadowBlur={3} shadowOffsetY={1} />
          ))}
          {grabBar && <Rect x={grabBar.p.x} y={grabBar.p.y} width={26} height={7} offsetX={13} offsetY={3.5} rotation={grabBar.rotation} cornerRadius={3.5} fill="white" stroke={T.accent} strokeWidth={2} />}
          {openingHandles.map(({ p, rotation }, i) => (
            <Rect key={i} x={p.x} y={p.y} width={6} height={16} offsetX={3} offsetY={8} rotation={rotation} cornerRadius={2} fill="white" stroke={T.accent} strokeWidth={2} />
          ))}
          {guides.map((g, i) => {
            const a = worldToScreen(viewport, g.a);
            const b = worldToScreen(viewport, g.b);
            return <Line key={`guide-${i}`} points={[a.x, a.y, b.x, b.y]} stroke={T.accent} strokeWidth={1} dash={[4, 4]} opacity={0.8} />;
          })}
          {!drag &&
            roomGrips.map((h) => {
              const p = worldToScreen(viewport, h.point);
              const across = h.side === "east" || h.side === "west";
              return (
                <Rect
                  key={`grip-${h.side}`}
                  x={p.x}
                  y={p.y}
                  width={across ? 8 : 28}
                  height={across ? 28 : 8}
                  offsetX={across ? 4 : 14}
                  offsetY={across ? 14 : 4}
                  cornerRadius={4}
                  fill="white"
                  stroke={T.accent}
                  strokeWidth={2}
                  shadowColor="rgba(0,0,0,0.18)"
                  shadowBlur={3}
                  shadowOffsetY={1}
                />
              );
            })}
          {pieceCorners.map((p, i) => (
            <Rect key={`piece-${i}`} x={p.x} y={p.y} width={9} height={9} offsetX={4.5} offsetY={4.5} fill="white" stroke={T.accent} strokeWidth={2} />
          ))}
          {snap && <SnapMarker snap={snap} viewport={viewport} />}
        </Group>
      </Layer>
    </Stage>
  );
}

export default PlanStage;
