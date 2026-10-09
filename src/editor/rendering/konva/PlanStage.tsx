"use client";

import type { Context } from "konva/lib/Context";
import type { Shape as KonvaShape } from "konva/lib/Shape";
import { memo, useMemo } from "react";
import { Circle, Group, Layer, Line, Rect, Shape, Stage, Text } from "react-konva";
import { deriveLevelGeometry } from "@/domain/geometry/derive";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { MultiPolygon, Ring } from "@/domain/geometry/polygons";
import type { Level, Point2 } from "@/domain/plan/types";
import { useDocumentState, useSessionState } from "../../state/editor";
import { displayedDocument, type OutlineDraft, type Selection, type SnapIndicator } from "../../state/stores";
import { worldToScreen, type Viewport } from "../../viewport/viewport";
import { furnitureSymbol } from "../scene/furnitureSymbols";
import { buildDimensions, buildPlanScene, openingPrimitive, type DimensionPrimitive, type FurniturePrimitive, type PlanScene } from "../scene/planScene";
import { SiteDecor } from "./SiteDecor";
import { registerStage } from "./stageRegistry";
import { FURNITURE_FILL, MATERIAL_FILL, PLAN_THEME as T, ROOM_FILL } from "./theme";

const flat = (points: Point2[]) => points.flatMap((p) => [p.x, p.y]);

function traceRings(ctx: Context, rings: Ring[]) {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  }
}

const ringsOf = (mp: MultiPolygon): Ring[] => mp.flatMap((p) => [p.outer, ...p.holes]);

interface PolyProps {
  rings: Ring[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  dash?: number[];
}

function Poly({ rings, fill, stroke, strokeWidth = 1, dash }: PolyProps) {
  return (
    <Shape
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        traceRings(ctx, rings);
        ctx.fillStrokeShape(shape);
      }}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      dash={dash}
      fillRule="evenodd"
      strokeScaleEnabled={false}
      listening={false}
      perfectDrawEnabled={false}
    />
  );
}

/**
 * One piece of furniture as a single shape: its parts filled by tone and
 * outlined with a hairline that stays the same width at every zoom.
 */
function FurnitureShape({ parts, opacity = 1 }: { parts: FurniturePrimitive["parts"]; opacity?: number }) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      opacity={opacity}
      sceneFunc={(ctx: Context, shape: KonvaShape) => {
        const scale = Math.abs(shape.getAbsoluteScale().x) || 1;
        ctx.setAttr("lineWidth", 0.9 / scale);
        ctx.setAttr("strokeStyle", T.furnitureStroke);
        ctx.setAttr("lineJoin", "round");
        for (const part of parts) {
          ctx.beginPath();
          part.ring.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          if (part.closed) {
            ctx.closePath();
            if (part.tone !== "none") {
              ctx.setAttr("fillStyle", FURNITURE_FILL[part.tone]);
              ctx.fill();
            }
          }
          ctx.stroke();
        }
      }}
    />
  );
}

/** World-space plan drawing; re-rendered only when the scene changes. */
const PlanContent = memo(function PlanContent({ scene, tinted, furnitureOpacity }: { scene: PlanScene; tinted: boolean; furnitureOpacity: number }) {
  return (
    <>
      {scene.rooms.map((room) => (
        <Poly key={room.id} rings={ringsOf(room.clear)} fill={tinted ? (room.floorMaterial ? MATERIAL_FILL[room.floorMaterial] : ROOM_FILL[room.type]) : T.roomFill} />
      ))}
      {furnitureOpacity > 0 && scene.furniture.map((f) => <FurnitureShape key={f.id} parts={f.parts} opacity={furnitureOpacity} />)}
      <Poly rings={ringsOf(scene.wallMass)} fill={T.wallFill} stroke={T.wallStroke} strokeWidth={1} />
      {scene.openings.map((o) => (
        <Group key={o.id}>
          <Poly rings={[o.cut]} fill={T.roomFill} stroke={T.roomFill} strokeWidth={2} />
          {o.jambs.map((j, i) => (
            <Line key={i} points={flat(j)} stroke={T.openingStroke} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
          ))}
          {o.kind === "door" && o.leaf && o.arc && (
            <>
              <Line points={flat(o.leaf)} stroke={T.openingStroke} strokeWidth={2} strokeScaleEnabled={false} listening={false} />
              <Line points={flat(o.arc)} stroke={T.openingStroke} strokeWidth={0.9} dash={[4, 3]} strokeScaleEnabled={false} listening={false} />
            </>
          )}
          {o.kind === "window" && o.frame && (
            <>
              <Poly rings={[o.frame]} fill={T.glass} stroke={T.openingStroke} strokeWidth={1.2} />
              {o.glazing?.map((g, i) => (
                <Line key={i} points={flat(g)} stroke={T.glazing} strokeWidth={1.2} strokeScaleEnabled={false} listening={false} />
              ))}
            </>
          )}
        </Group>
      ))}
    </>
  );
});

function GridShape({ viewport, gridSize }: { viewport: Viewport; gridSize: number }) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx: Context) => {
        const { scale, offsetX, offsetY, width, height } = viewport;
        const draw = (step: number, color: string) => {
          if (step * scale < 7) return;
          const x0 = Math.floor(-offsetX / scale / step) * step;
          const x1 = (width - offsetX) / scale;
          const y0 = Math.floor((offsetY - height) / scale / step) * step;
          const y1 = offsetY / scale;
          ctx.beginPath();
          for (let x = x0; x <= x1; x += step) {
            const sx = Math.round(x * scale + offsetX) + 0.5;
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx, height);
          }
          for (let y = y0; y <= y1; y += step) {
            const sy = Math.round(-y * scale + offsetY) + 0.5;
            ctx.moveTo(0, sy);
            ctx.lineTo(width, sy);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 1;
          ctx.stroke();
        };
        if (gridSize * scale >= 10) draw(gridSize, T.gridMinor);
        // Major lines every 1, 5 or 10 m, whichever stays legible at this zoom.
        const major = [1, 5, 10, 50].find((step) => step * scale >= 14) ?? 50;
        draw(major, T.gridMajor);
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
      {showText && <Text
        x={mid.x + n.x * textOffset}
        y={mid.y + n.y * textOffset}
        width={240}
        offsetX={120}
        offsetY={6.5}
        align="center"
        rotation={angle}
        text={dim.text}
        fontSize={dim.tone === "overall" ? 13 : 11}
        fontFamily={T.fontFamily}
        fill={color}
        fontStyle={dim.tone === "selection" ? "600" : "500"}
      />}
    </Group>
  );
}

let measureContext: CanvasRenderingContext2D | null | undefined;
const measured = new Map<string, number>();

/** Rendered width of a room name at the label font, px. */
function labelWidth(text: string): number {
  const cached = measured.get(text);
  if (cached !== undefined) return cached;
  if (measureContext === undefined) measureContext = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
  let width = text.length * 8.6;
  if (measureContext) {
    measureContext.font = `600 15px ${T.fontFamily}`;
    width = measureContext.measureText(text).width;
  }
  measured.set(text, width);
  return width;
}

function RoomLabels({ scene, viewport, selection }: { scene: PlanScene; viewport: Viewport; selection: Selection }) {
  return (
    <>
      {scene.rooms.map((room) => {
        const widthPx = (room.bounds.maxX - room.bounds.minX) * viewport.scale;
        const heightPx = (room.bounds.maxY - room.bounds.minY) * viewport.scale;
        // Show labels only where they fit legibly; the plan contents list always has them.
        const boxW = Math.min(widthPx - 8, 200);
        // Long names wrap onto a second line when the longest word still fits.
        const longestWord = Math.max(...room.name.split(/\s+/).map((w) => labelWidth(w)));
        const lines = labelWidth(room.name) + 4 <= boxW ? 1 : 2;
        if (longestWord + 4 > boxW || heightPx < 26 * lines) return null;
        const p = worldToScreen(viewport, room.label);
        const showArea = heightPx >= 30 + 18 * lines && widthPx >= 70;
        const selected = selection?.kind === "room" && selection.id === room.id;
        return (
          <Group key={room.id} x={p.x} y={p.y} listening={false}>
            <Text
              text={room.name}
              width={boxW}
              offsetX={boxW / 2}
              offsetY={(showArea ? 18 : 8) + (lines - 1) * 18}
              align="center"
              fontSize={15}
              lineHeight={1.15}
              fontStyle="600"
              fontFamily={T.fontFamily}
              fill={selected ? T.accent : T.roomLabel}
              // A soft halo keeps names legible over furniture.
              stroke={T.labelHalo}
              strokeWidth={3}
              fillAfterStrokeEnabled
              wrap={lines > 1 ? "word" : "none"}
            />
            {showArea && (
              <Text
                text={room.areaLabel}
                width={boxW}
                offsetX={boxW / 2}
                offsetY={-3}
                align="center"
                fontSize={13}
                fontFamily={T.fontFamily}
                fill={T.roomArea}
                stroke={T.labelHalo}
                strokeWidth={3}
                fillAfterStrokeEnabled
                wrap="none"
              />
            )}
          </Group>
        );
      })}
    </>
  );
}

function RearWallMarker({ level, viewport }: { level: Level; viewport: Viewport }) {
  if (!level.rearWallId) return null;
  const axis = deriveLevelGeometry(level).axes.get(level.rearWallId);
  if (!axis) return null;
  // Exterior is to the right of the counterclockwise envelope walls.
  const out = axis.wall.thickness / 2;
  const a = worldToScreen(viewport, { x: axis.start.x - axis.normal.x * out, y: axis.start.y - axis.normal.y * out });
  const b = worldToScreen(viewport, { x: axis.end.x - axis.normal.x * out, y: axis.end.y - axis.normal.y * out });
  const n = { x: axis.normal.x, y: -axis.normal.y };
  const off = 6;
  const mid = { x: (a.x + b.x) / 2 - n.x * 16, y: (a.y + b.y) / 2 - n.y * 16 };
  let angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return (
    <Group listening={false}>
      <Line
        points={[a.x - n.x * off, a.y - n.y * off, b.x - n.x * off, b.y - n.y * off]}
        stroke={T.rear}
        strokeWidth={3}
        lineCap="round"
      />
      <Text x={mid.x} y={mid.y} width={120} offsetX={60} offsetY={6} align="center" rotation={angle} text="REAR" fontSize={11} fontStyle="700" letterSpacing={1.5} fontFamily={T.fontFamily} fill={T.rear} />
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

function SelectionOverlay({ level, scene, selection, hover, issueIds }: { level: Level; scene: PlanScene; selection: Selection; hover: Selection; issueIds: string[] }) {
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
    .map((id) => (level.walls[id] ? { kind: "wall" as const, id } : level.openings[id] ? { kind: "opening" as const, id } : level.furniture[id] ? { kind: "furniture" as const, id } : null))
    .filter(Boolean) as Selection[];
  return (
    <>
      {hover && (hover.kind !== selection?.kind || hover.id !== selection?.id) && outline(hover, T.hover, 1.5)}
      {outline(selection, T.accent, 2, selection?.kind === "room" ? T.accentSoft : T.accentSoft)}
      {issues.map((s) => s && <Group key={`issue-${s.id}`}>{outline(s, T.error, 2, T.errorSoft)}</Group>)}
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
      {lastWall > 0 && <LengthPill at={last} text={`${lastWall.toFixed(2)} m`} tone={draft.problem ? "error" : "accent"} />}
    </Group>
  );
}

export function PlanStage({ width, height }: { width: number; height: number }) {
  const doc = useDocumentState(displayedDocument);
  const notice = useDocumentState((s) => s.notice);
  const previewIssue = useDocumentState((s) => s.preview?.issue ?? null);
  const viewport = useSessionState((s) => s.viewport);
  const selection = useSessionState((s) => s.selection);
  const hover = useSessionState((s) => s.hover);
  const snap = useSessionState((s) => s.snap);
  const wallDraft = useSessionState((s) => s.wallDraft);
  const outlineDraft = useSessionState((s) => s.outlineDraft);
  const openingDraft = useSessionState((s) => s.openingDraft);
  const settings = useSessionState((s) => s.settings);
  const tool = useSessionState((s) => s.tool);
  const workspace = useSessionState((s) => s.workspace);
  const drag = useSessionState((s) => s.drag);

  const level = doc.levels[0];
  const scene = useMemo(() => buildPlanScene(level), [level]);
  const dims = useMemo(() => buildDimensions(level, selection), [level, selection]);
  const geometry = deriveLevelGeometry(level);
  const issueIds = previewIssue?.entityIds ?? (notice?.tone === "error" ? notice.entityIds : []);

  const selectedAxis = selection?.kind === "wall" ? geometry.axes.get(selection.id) : undefined;
  const editable = tool === "select" && workspace === "structure";
  const showHandles = editable && selectedAxis && selectedAxis.wall.role === "internal";
  // The outline is reshaped from its corners and by dragging its walls.
  const outlineSelected = editable && (selection?.kind === "house" || selectedAxis?.wall.role === "external");
  const outlineEnv = outlineSelected ? analyzeEnvelope(level) : null;
  const cornerHandles = outlineEnv?.ok ? outlineEnv.info.axisRing.map((p) => worldToScreen(viewport, p)) : [];
  const grabBar =
    editable && selectedAxis?.wall.role === "external"
      ? { p: worldToScreen(viewport, { x: (selectedAxis.start.x + selectedAxis.end.x) / 2, y: (selectedAxis.start.y + selectedAxis.end.y) / 2 }), rotation: selectedAxis.orientation === "vertical" ? 90 : 0 }
      : null;
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

  // Furniture belongs to Designs; Structure shows it faded so the walls stay the focus.
  const furnitureOpacity = workspace === "structure" ? 0.35 : 1;
  const showProblems = workspace === "design";
  const furnitureDraft = useSessionState((s) => s.furnitureDraft);
  const draftSymbol = furnitureDraft ? furnitureSymbol(furnitureDraft.item) : null;

  const transform = { x: viewport.offsetX, y: viewport.offsetY, scaleX: viewport.scale, scaleY: -viewport.scale };

  return (
    <Stage width={width} height={height} listening={false} ref={registerStage}>
      <Layer listening={false}>
        <Rect x={0} y={0} width={width} height={height} fill={T.paper} />
        {settings.gridVisible && <GridShape viewport={viewport} gridSize={settings.gridSize} />}
        {scene.outsideRect && (
          <>
            <Group {...transform}>
              <SiteDecor house={scene.outsideRect} />
            </Group>
            <HouseShadow rect={scene.outsideRect} ring={scene.outsideRing} viewport={viewport} />
          </>
        )}
      </Layer>
      <Layer listening={false}>
        <Group {...transform}>
          <PlanContent scene={scene} tinted={workspace === "design"} furnitureOpacity={furnitureOpacity} />
        </Group>
      </Layer>
      <Layer listening={false}>
        <Group {...transform} name="transient">
          {showProblems &&
            scene.furniture
              .filter((f) => f.problem)
              .map((f) => <Poly key={`problem-${f.id}`} rings={[f.outline]} stroke={T.error} strokeWidth={1.5} dash={[5, 3]} fill={T.errorSoft} />)}
          <SelectionOverlay level={level} scene={scene} selection={selection} hover={hover} issueIds={issueIds} />
          {draftSymbol && (
            <>
              <FurnitureShape parts={draftSymbol.parts} opacity={0.75} />
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
        <RearWallMarker level={level} viewport={viewport} />
        <RoomLabels scene={scene} viewport={viewport} selection={selection} />
        {dims.map((dim) => (
          <Dimension key={dim.key} dim={dim} viewport={viewport} />
        ))}
        {draftRect && wallDraft && (
          <LengthPill
            at={worldToScreen(viewport, { x: (wallDraft.start.x + wallDraft.end.x) / 2, y: (wallDraft.start.y + wallDraft.end.y) / 2 })}
            text={`${draftRect.length.toFixed(3)} m`}
            tone={wallDraft.valid ? "accent" : "error"}
          />
        )}
        {drag === "drag-end" && selectedAxis && (
          <LengthPill
            at={worldToScreen(viewport, { x: (selectedAxis.start.x + selectedAxis.end.x) / 2, y: (selectedAxis.start.y + selectedAxis.end.y) / 2 })}
            text={`${selectedAxis.length.toFixed(3)} m`}
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
          {snap && <SnapMarker snap={snap} viewport={viewport} />}
        </Group>
      </Layer>
    </Stage>
  );
}

export default PlanStage;
