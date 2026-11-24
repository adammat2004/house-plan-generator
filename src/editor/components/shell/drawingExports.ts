import { assessHouse } from "@/domain/design/analysis";
import { analyzeEnvelope } from "@/domain/geometry/envelope";
import { effectiveRoofPitch } from "@/domain/project/exterior";
import { DEFAULT_APPEARANCE } from "@/domain/project/schema";
import { downloadUrl, projectFileName } from "@/persistence/jsonFile";
import { areaLabel, lengthText, sizeText } from "@/components/units";
import { buildElevations } from "../../rendering/drawing/elevations";
import { planToDxf } from "../../rendering/drawing/dxf";
import { planToIfc } from "../../rendering/drawing/ifc";
import { DRAWING_AREA, drawElevations, drawFrame, drawPlan, pdfText, type Pen } from "../../rendering/drawing/sheets";
import { editor, editorStores } from "../../state/editor";
import { furnishedPlanImage } from "./exports";

/**
 * The drawing set: a PDF to hand over (the house outside, the furnished
 * plan, each floor's plan to scale in black and white, and the four
 * elevations), and the plan as DXF for CAD and IFC for BIM.
 */

/** The design on show: its title and the file name to save it under. */
function designName() {
  const p = editorStores.project.getState();
  const meta = p.plans.find((x) => x.id === p.activePlanId);
  const title = meta ? (meta.origin.kind === "generated" && meta.origin.title ? meta.origin.title : meta.label) : "";
  return { project: p.name, design: p.plans.length > 1 && title ? `${meta?.label ?? ""}${meta && title !== meta.label ? ` · ${title}` : ""}` : "", file: p.plans.length > 1 && meta ? `${p.name} ${meta.label}` : p.name };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  downloadUrl(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const imageSize = (url: string) =>
  new Promise<{ w: number; h: number }>((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 16, h: 9 });
    img.src = url;
  });

/** Fits an image of w by h into the drawing area, centred. */
function fitImage(w: number, h: number) {
  const box = DRAWING_AREA;
  const s = Math.min(box.w / w, box.h / h);
  return { x: box.x + (box.w - w * s) / 2, y: box.y + (box.h - h * s) / 2, w: w * s, h: h * s };
}

export async function exportPdf() {
  const plan = editor.current();
  if (!analyzeEnvelope(plan.levels[0]).ok) {
    editor.notify("error", "The house needs a closed outline first.");
    return;
  }
  editor.notify("info", "Making the PDF…");
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3", compress: true });
  const pen = pdf as unknown as Pen;
  const names = designName();
  const appearance = { ...DEFAULT_APPEARANCE, ...editorStores.project.getState().appearance };
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const house = assessHouse(plan);
  const sheets: Array<{ title: string; scale: string; draw: () => Promise<void> | void }> = [];

  // 1. The house from outside, with its facts.
  sheets.push({
    title: "The house",
    scale: "Not to scale",
    draw: async () => {
      const { renderStillBlob } = await import("../../rendering/three/stills");
      const blob = await renderStillBlob(plan, { kind: "exterior" }, { width: 2000, height: 1125, appearance, quality: 0.9 }).catch(() => null);
      const facts = [
        `${house.bedrooms} bed · ${house.bathrooms} bath`,
        areaLabel(house.totalArea, 0),
        ...(house.outside ? [sizeText(house.outside.width, house.outside.depth, 1)] : []),
        plan.levels.length > 1 ? `${plan.levels.length} storeys` : "1 storey",
      ];
      const box = DRAWING_AREA;
      if (blob) {
        const url = await blobToDataUrl(blob);
        const w = box.w;
        const h = (w * 1125) / 2000;
        const fit = h > box.h - 30 ? { w: ((box.h - 30) * 2000) / 1125, h: box.h - 30 } : { w, h };
        pdf.addImage(url, "JPEG", box.x + (box.w - fit.w) / 2, box.y, fit.w, fit.h);
      }
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(22);
      pdf.setTextColor("#1c1a17");
      pdf.text(pdfText(names.project), box.x, box.y + box.h - 14);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(12);
      pdf.text(pdfText(facts.join("  ·  ")), box.x, box.y + box.h - 5);
    },
  });

  // 2. The furnished plan.
  const furnished = await furnishedPlanImage();
  if (furnished) {
    sheets.push({
      title: "Furnished plan",
      scale: "Not to scale",
      draw: async () => {
        const size = await imageSize(furnished.url);
        const at = fitImage(size.w, size.h);
        pdf.addImage(furnished.url, "PNG", at.x, at.y, at.w, at.h);
      },
    });
  }

  // 3. Each floor in black and white, to scale.
  for (const level of plan.levels) {
    let scale = "";
    sheets.push({
      title: plan.levels.length > 1 ? `${level.name} plan` : "Floor plan",
      get scale() {
        return scale;
      },
      draw: () => {
        const s = drawPlan(pen, level, DRAWING_AREA, (m) => lengthText(m, 2), (m2) => areaLabel(m2, 1));
        scale = s ? `1:${s}` : "";
      },
    });
  }

  // 4. The elevations.
  const elevations = buildElevations(plan, appearance.roofForm, effectiveRoofPitch(appearance));
  if (elevations.length) {
    let scale = "";
    sheets.push({
      title: "Elevations",
      get scale() {
        return scale;
      },
      draw: () => {
        const s = drawElevations(pen, elevations, DRAWING_AREA);
        scale = s ? `1:${s}` : "";
      },
    });
  }

  for (let i = 0; i < sheets.length; i++) {
    if (i > 0) pdf.addPage("a3", "landscape");
    pdf.setFont("helvetica", "normal");
    await sheets[i].draw();
    drawFrame(pen, { project: names.project, design: names.design || names.project, sheet: sheets[i].title, scale: sheets[i].scale, date, page: i + 1, pages: sheets.length });
  }
  download(pdf.output("blob"), projectFileName(names.file, ".pdf"));
  editor.notify("success", `PDF downloaded: ${sheets.length} pages, A3.`);
}

export function exportDxf() {
  const plan = editor.current();
  if (!analyzeEnvelope(plan.levels[0]).ok) {
    editor.notify("error", "The house needs a closed outline first.");
    return;
  }
  download(new Blob([planToDxf(plan)], { type: "application/dxf" }), projectFileName(designName().file, ".dxf"));
  editor.notify("success", "Plan downloaded as DXF, in metres. It opens in AutoCAD and most CAD programs.");
}

export function exportIfc() {
  const plan = editor.current();
  if (!analyzeEnvelope(plan.levels[0]).ok) {
    editor.notify("error", "The house needs a closed outline first.");
    return;
  }
  download(new Blob([planToIfc(plan, { name: designName().project })], { type: "application/x-step" }), projectFileName(designName().file, ".ifc"));
  editor.notify("success", "Model downloaded as IFC. It opens in Revit, ArchiCAD and other BIM programs.");
}
