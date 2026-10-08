import { describe, expect, it } from "vitest";
import { validateDocument } from "@/domain/commands/validate";
import { loadProjectDocument } from "@/domain/project/schema";
import { PROJECT_TEMPLATES, buildTemplatePlan, projectFromTemplate } from "@/domain/project/templates";

describe("project templates", () => {
  it.each(PROJECT_TEMPLATES.map((t) => [t.name, t] as const))("lays out %s as a valid, typed plan", (_, template) => {
    const plan = buildTemplatePlan(template, "t1");
    expect(plan).not.toBeNull();
    expect(validateDocument(plan!)).toEqual([]);
    const rooms = Object.values(plan!.levels[0].rooms);
    expect(rooms.filter((r) => r.type === "bedroom" || r.type === "primary_bedroom")).toHaveLength(template.brief.bedrooms);
  });

  it("creates independent projects that pass full project validation", () => {
    const template = PROJECT_TEMPLATES[0];
    const a = projectFromTemplate(template, { id: "p-a", idPrefix: "a", now: "2026-10-07T00:00:00Z" })!;
    const b = projectFromTemplate(template, { id: "p-b", idPrefix: "b", now: "2026-10-07T00:00:00Z" })!;
    expect(a.id).toBe("p-a");
    expect(a.brief).toEqual(template.brief);
    expect(loadProjectDocument(a, "now").ok).toBe(true);
    const idsA = Object.keys(a.plans[0].document.levels[0].walls);
    const idsB = new Set(Object.keys(b.plans[0].document.levels[0].walls));
    expect(idsA.some((id) => idsB.has(id))).toBe(false);
  });
});
