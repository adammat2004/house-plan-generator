import { analyzeEnvelope } from "@/domain/geometry/envelope";
import type { Ring } from "@/domain/geometry/polygons";
import type { PlanDocument } from "@/domain/plan/types";
import { buildPlanScene } from "../scene/planScene";

/**
 * The house as an IFC4 model, for BIM programs (Revit, ArchiCAD, BlenderBIM):
 * a storey per floor, each wall as an extruded solid with its doors and
 * windows cut through it as openings and filled, each room as a space, and a
 * floor slab under each storey. In metres. Element ids come from the plan's
 * ids, so the same plan exports the same file.
 */

const GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** A stable 22-character IFC GlobalId from any string. */
export function ifcGuid(seed: string): string {
  // Four 32-bit FNV-1a hashes with different offsets make 128 bits, read out 2 then 6 at a time.
  const bits: number[] = [];
  for (let k = 0; k < 4; k++) {
    let h = (0x811c9dc5 ^ Math.imul(k, 0x9e3779b9)) >>> 0;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    for (let b = 31; b >= 0; b--) bits.push((h >>> b) & 1);
  }
  const take = (from: number, count: number) => bits.slice(from, from + count).reduce((v, bit) => v * 2 + bit, 0);
  let out = GUID_CHARS[take(0, 2)];
  for (let i = 0; i < 21; i++) out += GUID_CHARS[take(2 + i * 6, 6)];
  return out;
}

/** A STEP string: quotes doubled, anything outside ASCII as \X2\…\X0\. */
function str(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (code >= 0x20 && code < 0x7f) out += ch;
    else out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
  }
  return `'${out}'`;
}

const num = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Number.isInteger(r) ? `${r}.` : `${r}`;
};

class Step {
  private lines: string[] = [];
  private next = 1;
  add(entity: string): string {
    const id = `#${this.next++}`;
    this.lines.push(`${id}=${entity};`);
    return id;
  }
  get data() {
    return this.lines.join("\n");
  }
}

const list = (ids: readonly string[]) => `(${ids.join(",")})`;

/** The plan as an IFC4 STEP file. */
export function planToIfc(plan: PlanDocument, opts: { name: string; now?: string } = { name: "House" }): string {
  const s = new Step();
  const point3 = (x: number, y: number, z: number) => s.add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`);
  const point2 = (x: number, y: number) => s.add(`IFCCARTESIANPOINT((${num(x)},${num(y)}))`);
  const dir3 = (x: number, y: number, z: number) => s.add(`IFCDIRECTION((${num(x)},${num(y)},${num(z)}))`);
  const zUp = dir3(0, 0, 1);
  const xAxis = dir3(1, 0, 0);
  const origin = point3(0, 0, 0);
  const world = s.add(`IFCAXIS2PLACEMENT3D(${origin},${zUp},${xAxis})`);
  const placement3 = (x: number, y: number, z: number, dx = 1, dy = 0) => s.add(`IFCAXIS2PLACEMENT3D(${point3(x, y, z)},${zUp},${dx === 1 && dy === 0 ? xAxis : dir3(dx, dy, 0)})`);
  const local = (relTo: string | null, axis: string) => s.add(`IFCLOCALPLACEMENT(${relTo ?? "$"},${axis})`);

  const units = s.add(
    `IFCUNITASSIGNMENT((${[
      s.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)"),
      s.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
      s.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
      s.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
    ].join(",")}))`,
  );
  const context = s.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  const body = s.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`);

  /** A shape: a profile extruded straight up by `height`. */
  const extruded = (profile: string, height: number) => {
    const solid = s.add(`IFCEXTRUDEDAREASOLID(${profile},${world},${zUp},${num(height)})`);
    const rep = s.add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',(${solid}))`);
    return s.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${rep}))`);
  };
  /** A rectangle w by d centred on (cx, cy) in its placement. */
  const rect = (cx: number, cy: number, w: number, d: number) => s.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${s.add(`IFCAXIS2PLACEMENT2D(${point2(cx, cy)},$)`)},${num(w)},${num(d)})`);
  const polygon = (ring: Ring) => {
    const pts = ring.map((p) => point2(p.x, p.y));
    return s.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${s.add(`IFCPOLYLINE(${list([...pts, pts[0]])})`)})`);
  };

  const project = s.add(`IFCPROJECT(${str(ifcGuid(`${plan.id}:project`))},$,${str(opts.name)},$,$,$,$,(${context}),${units})`);
  const sitePlace = local(null, world);
  const site = s.add(`IFCSITE(${str(ifcGuid(`${plan.id}:site`))},$,'Site',$,$,${sitePlace},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingPlace = local(sitePlace, world);
  const building = s.add(`IFCBUILDING(${str(ifcGuid(`${plan.id}:building`))},$,${str(opts.name)},$,$,${buildingPlace},$,$,.ELEMENT.,$,$,$)`);
  s.add(`IFCRELAGGREGATES(${str(ifcGuid(`${plan.id}:project-site`))},$,$,$,${project},(${site}))`);
  s.add(`IFCRELAGGREGATES(${str(ifcGuid(`${plan.id}:site-building`))},$,$,$,${site},(${building}))`);

  const storeys: string[] = [];
  for (const level of plan.levels) {
    const g = (what: string) => str(ifcGuid(`${plan.id}:${level.id}:${what}`));
    const storeyPlace = local(buildingPlace, placement3(0, 0, level.elevation));
    const storey = s.add(`IFCBUILDINGSTOREY(${g("storey")},$,${str(level.name)},$,$,${storeyPlace},$,$,.ELEMENT.,${num(level.elevation)})`);
    storeys.push(storey);
    const contained: string[] = [];
    const spaces: string[] = [];

    // The floor slab, under the floor.
    const env = analyzeEnvelope(level);
    if (env.ok) {
      const slabThickness = level.floorThickness ?? 0.2;
      const slab = s.add(`IFCSLAB(${g("slab")},$,'Floor',$,$,${local(storeyPlace, placement3(0, 0, -slabThickness))},${extruded(polygon(env.info.outsideRing), slabThickness)},$,.FLOOR.)`);
      contained.push(slab);
    }

    // Walls, each with its openings cut through and filled.
    for (const wall of Object.values(level.walls)) {
      const a = level.vertices[wall.startVertexId];
      const b = level.vertices[wall.endVertexId];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-6) continue;
      const wallPlace = local(storeyPlace, placement3(a.x, a.y, 0, (b.x - a.x) / len, (b.y - a.y) / len));
      const wallEntity = s.add(
        `IFCWALL(${g(wall.id)},$,${str(wall.role === "external" ? "Outside wall" : "Inside wall")},$,$,${wallPlace},${extruded(rect(len / 2, 0, len, wall.thickness), wall.height)},$,.STANDARD.)`,
      );
      contained.push(wallEntity);
      for (const o of Object.values(level.openings)) {
        if (o.wallId !== wall.id) continue;
        const sill = o.kind === "window" ? o.sillHeight : 0;
        const openingPlace = local(wallPlace, placement3(o.offset + o.width / 2, 0, sill));
        const opening = s.add(`IFCOPENINGELEMENT(${g(`${o.id}:opening`)},$,'Opening',$,$,${openingPlace},${extruded(rect(0, 0, o.width, wall.thickness + 0.2), o.height)},$,.OPENING.)`);
        s.add(`IFCRELVOIDSELEMENT(${g(`${o.id}:voids`)},$,$,$,${wallEntity},${opening})`);
        const fillPlace = local(openingPlace, world);
        const fillShape = extruded(rect(0, 0, o.width, Math.min(0.08, wall.thickness)), o.height);
        const fill =
          o.kind === "door"
            ? s.add(`IFCDOOR(${g(o.id)},$,'Door',$,$,${fillPlace},${fillShape},$,${num(o.height)},${num(o.width)},.DOOR.,.SINGLE_SWING_${o.hinge === "start" ? "LEFT" : "RIGHT"}.,$)`)
            : s.add(`IFCWINDOW(${g(o.id)},$,'Window',$,$,${fillPlace},${fillShape},$,${num(o.height)},${num(o.width)},.WINDOW.,.SINGLE_PANEL.,$)`);
        s.add(`IFCRELFILLSELEMENT(${g(`${o.id}:fills`)},$,$,$,${opening},${fill})`);
        contained.push(fill);
      }
    }

    // Rooms as spaces, as tall as the floor's ceiling.
    const scene = buildPlanScene(level);
    for (const room of scene.rooms) {
      const outer = room.clear[0]?.outer;
      if (!outer || outer.length < 3) continue;
      const space = s.add(
        `IFCSPACE(${g(room.id)},$,${str(room.name)},$,$,${local(storeyPlace, world)},${extruded(polygon(outer), level.defaultWallHeight)},${str(room.type)},.ELEMENT.,.INTERNAL.,$)`,
      );
      spaces.push(space);
    }

    if (contained.length) s.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${g("contains")},$,$,$,${list(contained)},${storey})`);
    if (spaces.length) s.add(`IFCRELAGGREGATES(${g("spaces")},$,$,$,${storey},${list(spaces)})`);
  }
  if (storeys.length) s.add(`IFCRELAGGREGATES(${str(ifcGuid(`${plan.id}:building-storeys`))},$,$,$,${building},${list(storeys)})`);

  const now = opts.now ?? new Date().toISOString().slice(0, 19);
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');",
    `FILE_NAME(${str(`${opts.name}.ifc`)},${str(now)},(''),(''),'HomeDesign','HomeDesign','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    s.data,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
