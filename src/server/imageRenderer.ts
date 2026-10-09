import { ApiError, GoogleGenAI, Modality } from "@google/genai";
import { renderPrompt, type RenderRequest } from "@/domain/design/renderRequest";

/**
 * Server-only: turns a 3D render of a room (or the house) into a realistic
 * photo with Google's Gemini image model. The key never leaves the server,
 * and the prompt is written here from structured fields only.
 */

export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

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
        config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "4:3" } },
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

export async function renderPhoto(request: RenderRequest, client?: ImageClient): Promise<RenderResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!client && !apiKey) return { ok: false, status: 503, message: "Photo renders aren't set up: add GEMINI_API_KEY to .env.local." };
  const images = client ?? (shared ??= geminiClient(apiKey!));
  try {
    const result = await images.generate({ model: IMAGE_MODEL, prompt: renderPrompt(request.view, request.style), imageBase64: request.image });
    if ("blocked" in result) return { ok: false, status: 422, message: `The image model didn't return a picture (${result.blocked.toLowerCase().replace(/_/g, " ")}). Try again, or another style.` };
    return { ok: true, image: result.data, mimeType: result.mimeType, model: IMAGE_MODEL };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401 || error.status === 403) return { ok: false, status: 503, message: "The Gemini API key was rejected. Check GEMINI_API_KEY in .env.local." };
      if (error.status === 429) return { ok: false, status: 429, message: "The image model is busy or the quota is used up. Try again in a minute." };
      if (error.status === 400) return { ok: false, status: 502, message: `The image request was rejected: ${error.message}` };
      return { ok: false, status: 502, message: `The image service had a problem (${error.status}).` };
    }
    throw error;
  }
}
