import { describe, expect, it } from "vitest";
import { conceptOf, likeBase } from "@/domain/design/concept/descriptor";
import { arrangementTitle } from "@/domain/design/stripPlanner";
import { ARRANGEMENTS } from "@/domain/design/zoning";
import { DIRECT_TITLE, SPLIT_TITLE, ZONE_TITLE } from "@/domain/design/zoneLayouts";

describe("what an arrangement id means", () => {
  it("names the strategy, the family and the title of every planner's ids", () => {
    expect(conceptOf("zones-l.s36o0")).toMatchObject({ strategy: "zones", direct: false, title: ZONE_TITLE });
    expect(conceptOf("zones-r.ebs36o0")).toMatchObject({ strategy: "zones", direct: true, title: DIRECT_TITLE });
    expect(conceptOf("zones-c.e1a.s36o0.d20-32o0@T:16x17.5:4")).toMatchObject({ strategy: "split", direct: true, title: SPLIT_TITLE });
    expect(conceptOf("zones-c.l1a.s36o0.s40o0")!.family).toBe(conceptOf("zones-c.r1b.s44o0.s44o0")!.family);
    expect(conceptOf("wings-sleeping-wing.p1.c15")).toMatchObject({ strategy: "wings" });
    expect(conceptOf("storeys-a.n.x.y")).toMatchObject({ strategy: "storeys" });
    expect(conceptOf(ARRANGEMENTS[0].id)).toMatchObject({ strategy: "strip", title: ARRANGEMENTS[0].title });
    expect(conceptOf("my own plan")).toBeNull();
    expect(conceptOf(undefined)).toBeNull();
    expect(arrangementTitle("zones-l.s36o0")).toBe(ZONE_TITLE);
  });

  it("says which layouts are like the one 'Show similar' started from", () => {
    // Mirror images of a zone layout are its family.
    expect(likeBase("zones-r.s36o1", "zones-l.s36o0@10x9")).toBe(true);
    expect(likeBase("zones-l.d20-32o0", "zones-l.s36o0")).toBe(false);
    // Anything else: any layout that isn't a zone layout.
    expect(likeBase("wings-quiet-garden.p0.c0", ARRANGEMENTS[0].id)).toBe(true);
    expect(likeBase("zones-l.s36o0", ARRANGEMENTS[0].id)).toBe(false);
    expect(likeBase(undefined, ARRANGEMENTS[0].id)).toBe(true);
  });
});
