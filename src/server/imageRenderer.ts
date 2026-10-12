import { ApiError, GoogleGenAI, Modality } from "@google/genai";
import { renderPrompt, type RenderRequest } from "@/domain/design/renderRequest";

/**
 * Server-only: turns a 3D render of a room (or the house) into a realistic
 * photo with Google's Gemini image model. The key never leaves the server,
 * and the prompt is written here from structured fields only.
 */

export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

/** A photo takes about 10 s; the call stops at 50 s, inside the route's 60 s maxDuration. */
const TIMEOUT_MS = 50_000;

export type RenderResult = { ok: true; image: string; mimeType: string; model: string } | { ok: false; status: number; message: string };

/** The one call made to the image model; replaceable in tests. */
export interface ImageClient {
  generate(args: { model: string; prompt: string; imageBase64: string }): Promise<{ data: string; mimeType: string } | { blocked: string }>;
}

export function imageRendererAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

function geminiClient(apiKey: string): ImageClient {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async generate({ model, prompt, imageBase64 }) {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBase64 } }] }],
        config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "4:3" }, abortSignal: AbortSignal.timeout(TIMEOUT_MS) },
      });
      const blocked = response.promptFeedback?.blockReason;
      if (blocked) return { blocked: String(blocked) };
      const candidate = response.candidates?.[0];
      const image = candidate?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
      if (image?.data) return { data: image.data, mimeType: image.mimeType ?? "image/png" };
      return { blocked: String(candidate?.finishReason ?? "NO_IMAGE") };
    },
  };
}

let shared: ImageClient | null = null;

/** Setup problems name the key to fix outside production; people using the app only learn that photos aren't available. */
const UNAVAILABLE = "Photos aren't available right now.";
const setupHint = (hint: string) => (process.env.NODE_ENV === "production" ? UNAVAILABLE : hint);
const DIDNT_COME_OUT = "That photo didn't come out. Try again.";

export async function renderPhoto(request: RenderRequest, client?: ImageClient): Promise<RenderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!client && !apiKey) return { ok: false, status: 503, message: setupHint("Photo renders aren't set up: add GEMINI_API_KEY to .env.local.") };
  const images = client ?? (shared ??= geminiClient(apiKey!));
  try {
    const result = await images.generate({ model: IMAGE_MODEL, prompt: renderPrompt(request.view, request.style), imageBase64: request.image });
    if ("blocked" in result) {
      console.warn(`Photo render returned no picture: ${result.blocked}`);
      return { ok: false, status: 422, message: "That photo didn't come out. Try again, or try another style." };
    }
    return { ok: true, image: result.data, mimeType: result.mimeType, model: IMAGE_MODEL };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return { ok: false, status: 503, message: setupHint("The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local.") };
      if (error.status === 429) return { ok: false, status: 429, message: "That's the photo limit for now. Try again later." };
      console.error("Photo render failed:", error);
      return { ok: false, status: 502, message: DIDNT_COME_OUT };
    }
    // The SDK aborts its own request when the timeout above fires, so either name can arrive.
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, status: 504, message: "That photo took too long. Try again." };
    console.error("Photo render failed:", error);
    return { ok: false, status: 502, message: "The photo service couldn't be reached. Try again in a minute." };
  }
}
