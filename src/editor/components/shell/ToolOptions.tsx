"use client";

import { NumberField } from "@/components/ui/controls";
import { LIMITS } from "@/domain/plan/defaults";
import { editorStores, useSessionState } from "../../state/editor";
import type { Settings } from "../../state/stores";
import { FurnitureCatalog } from "../furniture/FurnitureCatalog";

const setSettings = (patch: Partial<Settings>) => editorStores.session.setState((s) => ({ settings: { ...s.settings, ...patch } }));

const range = (v: number, lo: number, hi: number): true | string => (v >= lo && v <= hi ? true : `Use ${lo * 1000}–${hi * 1000} mm`);

/** Contextual presets for the active drawing tool, shown only while it is active. */
export function ToolOptions() {
  const tool = useSessionState((s) => s.tool);
  const settings = useSessionState((s) => s.settings);
  if (tool === "furniture") return <FurnitureCatalog />;
  if (tool !== "wall" && tool !== "door" && tool !== "window") return null;
  const mm = { unit: "mm", decimals: 0, scale: 1000, compact: true } as const;
  return (
    <div className="tool-options floating" role="group" aria-label="Tool options" data-testid="tool-options">
      {tool === "wall" && (
        <NumberField
          label="Wall thickness"
          value={settings.internalThickness}
          {...mm}
          onCommit={(v) => {
            const ok = range(v, LIMITS.minWallThickness, LIMITS.maxWallThickness);
            if (ok === true) setSettings({ internalThickness: v });
            return ok;
          }}
        />
      )}
      {tool === "door" && (
        <>
          <NumberField
            label="Door width"
            value={settings.door.width}
            {...mm}
            onCommit={(v) => {
              const ok = range(v, LIMITS.minOpeningWidth, 3);
              if (ok === true) setSettings({ door: { ...settings.door, width: v } });
              return ok;
            }}
          />
          <NumberField
            label="Height"
            value={settings.door.height}
            {...mm}
            onCommit={(v) => {
              const ok = range(v, 1, LIMITS.maxWallHeight);
              if (ok === true) setSettings({ door: { ...settings.door, height: v } });
              return ok;
            }}
          />
        </>
      )}
      {tool === "window" && (
        <>
          <NumberField
            label="Window width"
            value={settings.window.width}
            {...mm}
            onCommit={(v) => {
              const ok = range(v, LIMITS.minOpeningWidth, 6);
              if (ok === true) setSettings({ window: { ...settings.window, width: v } });
              return ok;
            }}
          />
          <NumberField
            label="Sill"
            value={settings.window.sillHeight}
            {...mm}
            onCommit={(v) => {
              const ok = range(v, 0, 3);
              if (ok === true) setSettings({ window: { ...settings.window, sillHeight: v } });
              return ok;
            }}
          />
        </>
      )}
    </div>
  );
}
