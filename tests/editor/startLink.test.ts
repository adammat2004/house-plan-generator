import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { projectFromRooms } from "@/domain/project/fromRooms";
import { projectFromPlan } from "@/domain/project/schema";
import { decodeSnapshot, encodeSnapshot, projectFromSnapshot, snapshotOf, snapshotProjectId } from "@/domain/project/startLink";
import { buildSamplePlan } from "../fixtures/samplePlan";

const NOW = "2026-10-10T12:00:00.000Z";

function roomsProject() {
  const result = projectFromRooms(DEFAULT_BRIEF, { id: "p1", idPrefix: "g", now: NOW, name: "My house", plot: { maxWidth: 16 } });
  if (!result.ok) throw new Error(result.message);
  return result.project;
}

/** A plan's content, ignoring its id (the receiving project gives it a new one). */
const fingerprint = (doc: unknown) => JSON.stringify({ ...(doc as object), id: undefined });

describe("Send to my computer links", () => {
  it("carries one layout, with its brief and plot, through a link and back", async () => {
    const project = roomsProject();
    const sent = project.plans[2];
    const snapshot = snapshotOf(project, sent.id)!;
    const payload = await encodeSnapshot(snapshot);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    // Small enough for a URL: measured at a few thousand characters for a family home.
    expect(payload.length).toBeLessThan(20_000);

    const back = await decodeSnapshot(payload);
    expect(back).toEqual(JSON.parse(JSON.stringify(snapshot)));

    const opened = projectFromSnapshot(back!, { id: await snapshotProjectId(payload), idPrefix: "s", now: NOW })!;
    expect(opened).not.toBeNull();
    expect(opened.sizing).toEqual({ footprint: "auto", plot: { maxWidth: 16 } });
    expect(opened.brief).toEqual(project.brief);
    const active = opened.plans.find((p) => p.id === opened.activePlanId)!;
    expect(active.label).toBe(sent.label);
    expect(active.origin).toEqual(sent.origin);
    // Exactly the plan that was sent; nothing re-planned.
    expect(fingerprint(active.document)).toBe(fingerprint(sent.document));
    // A rooms-first house keeps a shell to generate more from.
    expect(opened.plans).toHaveLength(2);
    expect(active.parentId).toBe(opened.plans[0].id);
  });

  it("opens a drawn house as its own plan", async () => {
    const project = { ...projectFromPlan(buildSamplePlan(), { now: NOW }), name: "Drawn" };
    const payload = await encodeSnapshot(snapshotOf(project, project.activePlanId)!);
    const opened = projectFromSnapshot((await decodeSnapshot(payload))!, { id: "sent-x", idPrefix: "s", now: NOW })!;
    expect(opened.name).toBe("Drawn");
    expect(opened.plans).toHaveLength(1);
    expect(opened.sizing).toBeUndefined();
    expect(fingerprint(opened.plans[0].document)).toBe(fingerprint(project.plans[0].document));
  });

  it("gives the same project id for the same link, and a different one for another", async () => {
    const project = roomsProject();
    const a = await encodeSnapshot(snapshotOf(project, project.plans[1].id)!);
    const b = await encodeSnapshot(snapshotOf(project, project.plans[2].id)!);
    expect(await snapshotProjectId(a)).toBe(await snapshotProjectId(a));
    expect(await snapshotProjectId(a)).not.toBe(await snapshotProjectId(b));
  });

  it("turns damaged or foreign links away", async () => {
    const project = roomsProject();
    const good = await encodeSnapshot(snapshotOf(project, project.plans[1].id)!);
    const deflate = async (text: string) => {
      const out = new Blob([new TextEncoder().encode(text)]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const bytes = new Uint8Array(await new Response(out).arrayBuffer());
      return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    };
    expect(await decodeSnapshot("")).toBeNull();
    expect(await decodeSnapshot("not base64!")).toBeNull();
    expect(await decodeSnapshot(good.slice(0, good.length / 2))).toBeNull();
    expect(await decodeSnapshot("AAAA")).toBeNull();
    expect(await decodeSnapshot(await deflate("{not json"))).toBeNull();
    expect(await decodeSnapshot(await deflate(JSON.stringify({ v: 2 })))).toBeNull();
    const badBrief = { ...snapshotOf(project, project.plans[1].id)!, brief: { bedrooms: "lots" } };
    expect(await decodeSnapshot(await deflate(JSON.stringify(badBrief)))).toBeNull();

    // A snapshot whose plan breaks the plan rules opens nothing.
    const snapshot = snapshotOf(project, project.plans[1].id)!;
    const broken = { ...snapshot, plan: { ...snapshot.plan, document: { ...(snapshot.plan.document as object), levels: [] } } };
    expect(projectFromSnapshot(broken, { id: "sent-y", idPrefix: "s", now: NOW })).toBeNull();
  });
});
