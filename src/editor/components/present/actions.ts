import { editor, editorStores } from "../../state/editor";
import type { CameraMode, LightingPreset, View3DState } from "../../state/stores";

export const set3d = (patch: Partial<View3DState>) => editor.setView3d(patch);

/** Points the camera, reframing even if the mode is unchanged. */
export function aim(camera: CameraMode, interiorRoomId: string | null = null) {
  const v = editorStores.session.getState().view3d;
  set3d({ camera, interiorRoomId, cameraKey: v.cameraKey + 1 });
}

export const LIGHTING_LABEL: Record<LightingPreset, string> = { morning: "Morning", midday: "Daylight", evening: "Evening", night: "Night" };
