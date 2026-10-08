"use client";

import { memo, useMemo } from "react";
import { Circle, Group, Rect } from "react-konva";
import type { Rect as WorldRect } from "@/domain/geometry/vector";
import { plant, type Tree } from "../scene/site";
import { SITE_THEME as S } from "./theme";

function TreeShape({ tree }: { tree: Tree }) {
  const { x, y, r, shade } = tree;
  const lobes = 9;
  return (
    <Group x={x} y={y} listening={false}>
      {/* Shadow falls to the south-east (down-right on screen). */}
      <Circle x={r * 0.3} y={-r * 0.3} radius={r} fill={S.treeShadow} listening={false} perfectDrawEnabled={false} />
      <Circle radius={r * 0.72} fill={shade} listening={false} perfectDrawEnabled={false} />
      {Array.from({ length: lobes }, (_, i) => {
        const a = (i / lobes) * Math.PI * 2;
        return (
          <Circle
            key={i}
            x={Math.cos(a) * r * (0.45 + ((i * 37) % 10) / 50)}
            y={Math.sin(a) * r * (0.45 + ((i * 53) % 10) / 50)}
            radius={r * (0.36 + ((i * 29) % 10) / 60)}
            fillRadialGradientStartPoint={{ x: -r * 0.2, y: r * 0.2 }}
            fillRadialGradientStartRadius={0}
            fillRadialGradientEndPoint={{ x: 0, y: 0 }}
            fillRadialGradientEndRadius={r * 0.6}
            fillRadialGradientColorStops={[0, S.canopyLight, 1, shade]}
            listening={false}
            perfectDrawEnabled={false}
          />
        );
      })}
      {/* Sunlit tufts towards the north-west. */}
      {[0.5, 1.4, 2.3].map((t, i) => (
        <Circle
          key={`hi${i}`}
          x={Math.cos(t + 1.2) * r * 0.32}
          y={Math.sin(t + 1.2) * r * 0.32}
          radius={r * 0.3}
          fill={S.canopyLight}
          opacity={0.35}
          listening={false}
          perfectDrawEnabled={false}
        />
      ))}
    </Group>
  );
}

/**
 * Decorative garden around the house, drawn in world metres under the plan.
 * Named "transient" so image exports leave it out.
 */
export const SiteDecor = memo(function SiteDecor({ house }: { house: WorldRect }) {
  const { trees, tiles } = useMemo(() => plant(house), [house]);
  return (
    <Group name="transient" listening={false}>
      {tiles.map((t, i) => (
        <Rect key={i} x={t.x} y={t.y} width={t.size} height={t.size} fill={S.paving} stroke={S.pavingJoint} strokeWidth={1} strokeScaleEnabled={false} listening={false} perfectDrawEnabled={false} />
      ))}
      {trees.map((tree, i) => (
        <TreeShape key={i} tree={tree} />
      ))}
    </Group>
  );
});
