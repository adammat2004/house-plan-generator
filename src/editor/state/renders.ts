import { createStore } from "zustand/vanilla";
import { photoTargets, renderKey, renderViewFor, targetKey, type StillTarget } from "@/domain/design/renderRequest";
import type { Id, Level, PlanDocument, Room } from "@/domain/plan/types";
import type { Appearance, InteriorStyle } from "@/domain/project/schema";
import type { RenderRecord, RenderStorage } from "@/persistence/planStorage";
import type { PhotoRenderer } from "./imageRenderer";

/**
 * Photo renders of a project's rooms. Each one starts from a 3D still of the
 * room, goes to the image model through the server, and is kept in browser
 * storage beside (not inside) the autosaved project. This store never
 * touches the project's revision, so autosave ignores it.
 */

export interface PhotoEntry {
  /** An object URL for the stored image. */
  url: string;
  /** What the view showed when it was rendered; compare with renderKey to see if the plan has changed. */
  sourceHash: string;
  style: string;
  createdAt: string;
}

export interface RenderBatch {
  planId: Id;
  done: number;
  total: number;
  failed: number;
  /** Name of the view being rendered. */
  current: string | null;
}

export interface RendersState {
  projectId: Id | null;
  available: "unknown" | "yes" | "no";
  /** planId → view ("exterior" or a room id) → photo. */
  byPlan: Record<Id, Record<string, PhotoEntry>>;
  batch: RenderBatch | null;
  /** The last problem, shown beside the button. */
  error: string | null;
  /** planId → view → the 3D still shown while a photo is missing or its render failed. Session only. */
  fallbacks: Record<Id, Record<string, FallbackEntry>>;
}

export interface FallbackEntry {
  url: string;
  sourceHash: string;
}

export interface RenderDeps {
  storage: RenderStorage;
  renderer: PhotoRenderer;
  /** A 3D still of the view as a JPEG, or null where WebGL isn't available. */
  still(plan: Level | PlanDocument, target: StillTarget, appearance: Appearance): Promise<Blob | null>;
  /** Shrinks a returned image for storage; identity where that isn't possible. */
  compress?(blob: Blob): Promise<Blob>;
}

const CONCURRENCY = 2;

const toBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const fromBase64 = (data: string, mimeType: string) => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
};

export function createRenders(deps: RenderDeps) {
  const store = createStore<RendersState>(() => ({ projectId: null, available: "unknown", byPlan: {}, batch: null, error: null, fallbacks: {} }));
  let abort: AbortController | null = null;
  const urls = new Set<string>();
  const oneOffs = new Map<string, string>();

  const keep = (planId: Id, view: string, record: Pick<RenderRecord, "sourceHash" | "style" | "createdAt">, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.add(url);
    store.setState((s) => {
      const old = s.byPlan[planId]?.[view]?.url;
      if (old) {
        URL.revokeObjectURL(old);
        urls.delete(old);
      }
      return { byPlan: { ...s.byPlan, [planId]: { ...s.byPlan[planId], [view]: { url, sourceHash: record.sourceHash, style: record.style, createdAt: record.createdAt } } } };
    });
  };

  const keepFallback = (planId: Id, view: string, sourceHash: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.add(url);
    store.setState((s) => {
      const old = s.fallbacks[planId]?.[view]?.url;
      if (old) {
        URL.revokeObjectURL(old);
        urls.delete(old);
      }
      return { fallbacks: { ...s.fallbacks, [planId]: { ...s.fallbacks[planId], [view]: { url, sourceHash } } } };
    });
  };

  return {
    store,

    /** Shows the 3D still of a view where its photo isn't there yet (no image-model call). */
    async showStill(planId: Id, level: Level | PlanDocument, target: StillTarget, appearance: Appearance, style: InteriorStyle): Promise<void> {
      const hash = renderKey(level, target, appearance, style);
      if (store.getState().fallbacks[planId]?.[targetKey(target)]?.sourceHash === hash) return;
      const still = await deps.still(level, target, appearance);
      if (still) keepFallback(planId, targetKey(target), hash, still);
    },

    /** Loads a project's stored photos, dropping those of plans it no longer has. */
    async load(projectId: Id, livePlanIds: ReadonlySet<Id>) {
      this.reset();
      store.setState({ projectId });
      try {
        await deps.storage.prune(projectId, livePlanIds);
        const records = await deps.storage.list(projectId);
        if (store.getState().projectId !== projectId) return;
        // Home's cover (state/covers.ts) is kept with the photos but isn't one.
        for (const r of records) if (r.view !== "cover") keep(r.planId, r.view, r, new Blob([r.bytes], { type: r.mimeType }));
      } catch {
        // Photos are a nicety: without storage the project still works.
      }
    },

    async checkAvailable() {
      store.setState({ available: (await deps.renderer.available()) ? "yes" : "no" });
    },

    /**
     * Renders photos of a plan's main views that are missing or out of date
     * (or all of them with `force`), two at a time.
     */
    async renderPlan(planId: Id, level: Level | PlanDocument, appearance: Appearance, style: InteriorStyle, options: { targets?: StillTarget[]; force?: boolean } = {}): Promise<number> {
      const projectId = store.getState().projectId;
      if (!projectId || store.getState().batch) return 0;
      const existing = store.getState().byPlan[planId] ?? {};
      const targets = (options.targets ?? photoTargets(level)).filter((t) => options.force || existing[targetKey(t)]?.sourceHash !== renderKey(level, t, appearance, style));
      if (!targets.length) return 0;
      abort = new AbortController();
      const signal = abort.signal;
      const rooms: Record<Id, Room> = "levels" in level ? Object.assign({}, ...level.levels.map((l) => l.rooms)) : level.rooms;
      const nameOf = (t: StillTarget) => (t.kind === "room" ? (rooms[t.roomId]?.name ?? "Room") : t.kind === "aerial" ? "From above" : "Exterior");
      store.setState({ batch: { planId, done: 0, total: targets.length, failed: 0, current: nameOf(targets[0]) }, error: null });
      const queue = [...targets];
      let rendered = 0;

      const one = async (target: StillTarget) => {
        const view = renderViewFor(level, target, appearance);
        const still = view && (await deps.still(level, target, appearance));
        if (!view || !still) throw new Error("This browser couldn't draw the 3D view to start from.");
        const hash = renderKey(level, target, appearance, style);
        // When the image model can't help, the view keeps its 3D still.
        const result = await deps.renderer.render({ view, style, image: await toBase64(still) }, signal).catch((e: Error) => ({ ok: false as const, offline: false, message: e.message || "The render failed." }));
        if (!result.ok) {
          if (result.offline) store.setState({ available: "no" });
          if (!signal.aborted) keepFallback(planId, targetKey(target), hash, still);
          throw new Error(result.message);
        }
        const photo = fromBase64(result.image, result.mimeType);
        const small = deps.compress ? await deps.compress(photo) : photo;
        const record: RenderRecord = {
          projectId,
          planId,
          view: targetKey(target),
          bytes: await small.arrayBuffer(),
          mimeType: small.type || result.mimeType,
          sourceHash: renderKey(level, target, appearance, style),
          style,
          model: result.model,
          createdAt: new Date().toISOString(),
        };
        if (signal.aborted || store.getState().projectId !== projectId) return;
        await deps.storage.put(record).catch(() => undefined);
        keep(planId, record.view, record, small);
        rendered++;
      };

      const worker = async () => {
        for (let target = queue.shift(); target; target = queue.shift()) {
          if (signal.aborted) return;
          store.setState((s) => (s.batch ? { batch: { ...s.batch, current: nameOf(target!) } } : {}));
          try {
            await one(target);
            store.setState((s) => (s.batch ? { batch: { ...s.batch, done: s.batch.done + 1 } } : {}));
          } catch (error) {
            if ((error as Error).name === "AbortError" || signal.aborted) return;
            store.setState((s) => ({ error: (error as Error).message, batch: s.batch ? { ...s.batch, done: s.batch.done + 1, failed: s.batch.failed + 1 } : null }));
            // A setup problem won't fix itself on the next room.
            if (store.getState().available === "no") queue.length = 0;
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      store.setState({ batch: null });
      abort = null;
      return rendered;
    },

    /**
     * One photo of a view that isn't a saved plan (the room picker's live
     * preview). Kept for the session only, keyed by what it shows.
     */
    async renderOne(level: Level | PlanDocument, target: StillTarget, appearance: Appearance, style: InteriorStyle): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
      const key = `${targetKey(target)}:${renderKey(level, target, appearance, style)}`;
      const hit = oneOffs.get(key);
      if (hit) return { ok: true, url: hit };
      const view = renderViewFor(level, target, appearance);
      const still = view && (await deps.still(level, target, appearance));
      if (!view || !still) return { ok: false, message: "This browser couldn't draw the 3D view to start from." };
      const result = await deps.renderer.render({ view, style, image: await toBase64(still) });
      if (!result.ok) {
        if (result.offline) store.setState({ available: "no" });
        return { ok: false, message: result.message };
      }
      const url = URL.createObjectURL(fromBase64(result.image, result.mimeType));
      urls.add(url);
      oneOffs.set(key, url);
      return { ok: true, url };
    },

    cancel() {
      abort?.abort();
      abort = null;
      store.setState({ batch: null });
    },

    /** Forgets everything (another project is opening). */
    reset() {
      this.cancel();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      oneOffs.clear();
      store.setState({ projectId: null, byPlan: {}, batch: null, error: null, fallbacks: {} });
    },
  };
}

export type Renders = ReturnType<typeof createRenders>;
