import { GoogleGenAI, Modality } from "@google/genai";

/** The image model the reference pictures come from; the same one the app's photos use. */
export const REFERENCE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

/**
 * One reference picture from Gemini. `like` is an approved picture of
 * another piece in the same style, sent so the set's materials match.
 */
export async function referencePicture(prompt: string, like?: Buffer): Promise<Buffer> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY isn't set (.env.local).");
  const ai = new GoogleGenAI({ apiKey });
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = like
    ? [{ text: `${prompt} Match the materials, colours and finish of the furniture in the attached picture, but not its shape.` }, { inlineData: { mimeType: "image/png", data: like.toString("base64") } }]
    : [{ text: prompt }];
  const response = await ai.models.generateContent({
    model: REFERENCE_MODEL,
    contents: [{ role: "user", parts }],
    config: { responseModalities: [Modality.IMAGE], imageConfig: { aspectRatio: "1:1" }, abortSignal: AbortSignal.timeout(90_000) },
  });
  const image = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!image?.data) throw new Error(`No picture came back (${response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason ?? "no image"}).`);
  return Buffer.from(image.data, "base64");
}
