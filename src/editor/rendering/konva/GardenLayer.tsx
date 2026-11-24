"use client";

import type { Context } from "konva/lib/Context";
import { memo } from "react";
import { Group, Shape } from "react-konva";
import type { Garden, GardenTree } from "../scene/garden";
import { finishPattern } from "./patterns";
import { Poly, ringsOf } from "./Poly";
import { PLAN_THEME, SITE_THEME as S } from "./theme";

/** Where shadows fall, m per metre of height: to the south-east, down and right on screen. */
const SHADOW = { x: 0.25, y: -0.25 };

/** Every tree as one shape: their shadows first, then each canopy, lit from the north-west. */
function Trees({ trees }: { trees: GardenTree[] }) {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx: Context, shape) => {
        const scale = Math.abs(shape.getAbsoluteScale().x) || 1;
        ctx.beginPath();
        for (const t of trees) {
          const [x, y] = [t.x + t.r * 0.35, t.y - t.r * 0.35];
          ctx.moveTo(x + t.r, y);
          ctx.arc(x, y, t.r, 0, Math.PI * 2);
        }
        ctx.setAttr("fillStyle", S.treeShadow);
        ctx.fill();
        // A ring of lobes round a full middle, as one path so they fill as one canopy; `grow` widens every lobe.
        const canopy = (t: GardenTree, grow: number) => {
          ctx.beginPath();
          const lobes = 7;
          for (let i = 0; i < lobes; i++) {
            const a = (i / lobes) * Math.PI * 2 + t.shade;
            const [x, y, r] = [t.x + Math.cos(a) * t.r * 0.45, t.y + Math.sin(a) * t.r * 0.45, t.r * (0.48 + ((i * 37) % 7) / 70) + grow];
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
          ctx.moveTo(t.x + t.r * 0.6 + grow, t.y);
          ctx.arc(t.x, t.y, t.r * 0.6 + grow, 0, Math.PI * 2);
        };
        for (const t of trees) {
          // The edge is the canopy a pixel wider underneath, so only its outline shows, not every lobe's.
          canopy(t, 1.2 / scale);
          ctx.setAttr("fillStyle", S.canopyEdge);
          ctx.fill();
          canopy(t, 0);
          ctx.setAttr("fillStyle", S.canopy[t.shade % S.canopy.length]);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(t.x - t.r * 0.22, t.y + t.r * 0.22, t.r * 0.42, 0, Math.PI * 2);
          ctx.setAttr("fillStyle", S.canopyLight);
          ctx.fill();
        }
      }}
    />
  );
}

/** How far in from the edge of a made-up garden it fades into the paper, m. */
const FADE = 3;

/**
 * The edge of a made-up garden, fading into the paper rather than stopping
 * at a hard line: a band along each side of the plot, paper at the edge and
 * clear by FADE inside it. A site's own plot keeps its hedges crisp.
 */
function GardenFade({ plot, paper }: { plot: Garden["plot"]; paper: string }) {
  return (
    <Shape
      name="garden-fade"
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(ctx: Context) => {
        const clear = paper.length === 7 ? `${paper}00` : "rgba(0,0,0,0)";
        const band = (x0: number, y0: number, x1: number, y1: number, rect: [number, number, number, number]) => {
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, paper);
          g.addColorStop(1, clear);
          ctx.setAttr("fillStyle", g);
          ctx.fillRect(...rect);
        };
        // A little past the plot too, so no sliver of the lawn's anti-aliased edge shows.
        const o = 0.1;
        const [minX, minY, maxX, maxY] = [plot.minX - o, plot.minY - o, plot.maxX + o, plot.maxY + o];
        const [w, h, f] = [maxX - minX, maxY - minY, FADE + o];
        band(minX, 0, minX + f, 0, [minX, minY, f, h]);
        band(maxX, 0, maxX - f, 0, [maxX - f, minY, f, h]);
        band(0, minY, 0, minY + f, [minX, minY, w, f]);
        band(0, maxY, 0, maxY - f, [minX, maxY - f, w, f]);
      }}
    />
  );
}

/**
 * The garden round the house in world metres, under the plan: lawn,
 * gravel, terrace, path, hedges and trees, a handful of shapes in all.
 * Plain plan images leave it out; presentation images keep it.
 */
export const GardenLayer = memo(function GardenLayer({ garden, density }: { garden: Garden; density: number }) {
  // The garden is seen from further off than the floors; half their density is plenty.
  const d = Math.max(32, density / 2);
  return (
    <Group name="garden" listening={false}>
      {/* Where a made-up garden has no hedge, the lawn runs on to the plot's edge. */}
      <Poly rings={ringsOf(garden.fromSite ? garden.lawn : garden.lawnToEdge)} fill={S.lawn} pattern={finishPattern("lawn", d)} />
      {/* Hedges mark a real boundary: the site's plot. A garden made up round the house fades out instead. */}
      {garden.fromSite && (
        <>
          <Group x={SHADOW.x} y={SHADOW.y} listening={false}>
            <Poly rings={ringsOf(garden.hedges)} fill={S.hedgeShadow} />
          </Group>
          <Poly rings={ringsOf(garden.hedges)} fill={S.hedge} stroke={S.hedgeEdge} strokeWidth={1} />
        </>
      )}
      <Poly rings={ringsOf(garden.apron)} fill={S.gravel} pattern={finishPattern("gravel", density)} />
      <Poly rings={ringsOf(garden.terrace)} fill={S.paving} pattern={finishPattern("paving", d)} stroke={S.pavingJoint} strokeWidth={1} />
      <Poly rings={ringsOf(garden.path)} fill={S.paving} pattern={finishPattern("paving", d)} stroke={S.pavingJoint} strokeWidth={1} />
      <Trees trees={garden.trees} />
      {!garden.fromSite && <GardenFade plot={garden.plot} paper={PLAN_THEME.paper} />}
    </Group>
  );
});
