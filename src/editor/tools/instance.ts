import { editor, editorStores } from "../state/editor";
import { createToolController } from "./controller";

/** The application's tool controller, bound to the editor singleton. */
export const toolController = createToolController(editorStores, editor);
