import type { RenderRequest } from "@/domain/design/renderRequest";

/**
 * How the editor reaches the photo renderer: through the app's own server
 * route, which holds the Gemini key. `offline` means it isn't set up (or the
 * route is missing), so the editor shows how to set it up instead of failing.
 */
export type PhotoResult = { ok: true; image: string; mimeType: string; model: string } | { ok: false; offline: boolean; message: string };

export interface PhotoRenderer {
  available(): Promise<boolean>;
  render(request: RenderRequest, signal?: AbortSignal): Promise<PhotoResult>;
}

export function httpPhotoRenderer(endpoint = "/api/design/render"): PhotoRenderer {
  return {
    async available() {
      try {
        const response = await fetch(endpoint);
        return response.ok && (await response.json()).available === true;
      } catch {
        return false;
      }
    },

    async render(request, signal) {
      let response: Response;
      try {
        response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal });
      } catch (error) {
        if ((error as Error).name === "AbortError") throw error;
        return { ok: false, offline: true, message: "The photo renderer couldn't be reached." };
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        return { ok: false, offline: response.status === 503 || response.status === 404, message: typeof body?.error === "string" ? body.error : `The photo render failed (${response.status}).` };
      }
      if (typeof body?.image !== "string") return { ok: false, offline: false, message: "The photo renderer sent back no picture." };
      return { ok: true, image: body.image, mimeType: body.mimeType ?? "image/jpeg", model: body.model ?? "" };
    },
  };
}
