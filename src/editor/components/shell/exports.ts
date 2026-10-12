import { downloadProject, downloadUrl, projectFileName } from "@/persistence/jsonFile";
import { assessHouse } from "@/domain/design/analysis";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { exportPlanImage } from "../../rendering/konva/stageRegistry";
import { composePresentation } from "../../rendering/presentation";
import { buildGarden } from "../../rendering/scene/garden";
import { worldToScreen } from "../../viewport/viewport";
import { exportModel, snapshot3d, whenViewerReady } from "../../rendering/three/registry";
import { editor, editorStores } from "../../state/editor";
import { in3d, projectDocument } from "../../state/stores";

/**
 * What the Export menu and Review's downloads do. 3D downloads need the 3D
 * view on the page, so they show it first and wait for it.
 */
export function exportProjectFile() {
  downloadProject(projectDocument(editorStores));
  editor.notify("success", "Project file downloaded.");
}

/** The picture's file name: the project, the plan when there are several, and the floor on show when there are several. */
function pictureName(suffix = ""): string {
  const p = editorStores.project.getState();
  const label = p.plans.length > 1 ? ` ${p.plans.find((plan) => plan.id === p.activePlanId)?.label ?? ""}` : "";
  // A house of several floors exports the floor on show, named for it.
  const floor = editor.current().levels.length > 1 ? ` ${editor.activeLevel().name}` : "";
  return projectFileName(`${p.name}${label}${floor}${suffix}`, ".png");
}

export function exportPlanPng() {
  const url = exportPlanImage();
  if (!url) {
    editor.notify("error", "The plan isn't ready to export yet.");
    return;
  }
  downloadUrl(url, pictureName());
}

/** The longer side of a presentation image, px. */
const PRESENTATION_SIZE = 2400;

/**
 * The plan in its garden, cropped to the plot, on a page with the
 * project's name, the plan's size and rooms, the date and a scale bar. As
 * on screen otherwise: the floor on show, its labels and the compass.
 */
export async function exportPresentationPng() {
  const p = editorStores.project.getState();
  const plan = editor.current();
  const ground = plan.levels[0];
  const env = analyzeEnvelope(ground);
  const viewport = editorStores.session.getState().viewport;
  if (!env.ok) {
    editor.notify("error", "The house needs a closed outline first.");
    return;
  }
  const area = buildGarden(ground, p.site)?.plot ?? env.info.outsideRect;
  const margin = 0.8;
  const a = worldToScreen(viewport, { x: area.minX - margin, y: area.maxY + margin });
  const b = worldToScreen(viewport, { x: area.maxX + margin, y: area.minY - margin });
  const crop = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  const pixelRatio = Math.min(4, Math.max(1, PRESENTATION_SIZE / Math.max(crop.width, crop.height)));
  const url = crop.width > 0 && crop.height > 0 ? exportPlanImage({ crop, pixelRatio, presentation: true }) : null;
  if (!url) {
    editor.notify("error", "The plan isn't ready to export yet.");
    return;
  }
  const image = new Image();
  image.src = url;
  await image.decode();
  const meta = p.plans.find((x) => x.id === p.activePlanId);
  const planName = meta ? (meta.origin.kind === "generated" && meta.origin.title ? meta.origin.title : meta.label) : "";
  const house = assessHouse(plan);
  const page = composePresentation(image, {
    title: p.plans.length > 1 && planName ? `${p.name}: ${planName}` : p.name,
    subtitle: [
      `${Math.round(house.totalArea)} m²`,
      `${house.bedrooms} bed`,
      `${house.bathrooms} bath`,
      ...(plan.levels.length > 1 ? [editor.activeLevel().name] : []),
      new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
    ].join(" · "),
    metresPerPixel: 1 / (viewport.scale * pixelRatio),
  });
  if (!page) {
    editor.notify("error", "The plan isn't ready to export yet.");
    return;
  }
  downloadUrl(page.toDataURL("image/png"), pictureName(" presentation"));
}

/** Shows the 3D view if it isn't on show, and says whether it's ready. */
async function ready3d(): Promise<boolean> {
  if (!in3d(editorStores.session.getState())) editor.setShow3d(true);
  if (await whenViewerReady()) return true;
  editor.notify("error", "The 3D view isn't ready to export yet.");
  return false;
}

export async function export3dPng() {
  if (!(await ready3d())) return;
  const url = snapshot3d();
  if (!url) {
    editor.notify("error", "The 3D view isn't ready to export yet.");
    return;
  }
  downloadUrl(url, projectFileName(`${editorStores.project.getState().name} 3D`, ".png"));
}

export async function export3dModel() {
  if (!(await ready3d())) return;
  const blob = await exportModel();
  if (!blob) {
    editor.notify("error", "The 3D view isn't ready to export yet.");
    return;
  }
  const url = URL.createObjectURL(blob);
  downloadUrl(url, projectFileName(editorStores.project.getState().name, ".glb"));
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  editor.notify("success", "3D model downloaded (.glb). It opens in most 3D viewers and modelling apps.");
}
