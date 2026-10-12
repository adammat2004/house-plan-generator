import { editor, editorStores } from "../state/editor";
import { chromeInsets } from "../viewport/chrome";
import { createToolController } from "./controller";

/** The plan canvas element, which floating chrome is measured against. */
export const planCanvasElement = () => (typeof document === "undefined" ? null : document.querySelector("[data-testid=plan-canvas]"));

/** The application's tool controller, bound to the editor singleton; fits measure the real chrome. */
export const toolController = createToolController(editorStores, editor, { insets: () => chromeInsets(planCanvasElement()) });
