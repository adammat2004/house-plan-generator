import { aiReplySchema, type AiReply, type AiRequest } from "@/domain/design/aiInterpretation";

/**
 * How the editor reaches the language model: through the app's own server
 * route, which holds the API key. `offline` means the AI layer isn't set up
 * or can't be reached, so callers fall back to the rule-based reader
 * without troubling the user.
 */
export type AiResult = { ok: true; reply: AiReply } | { ok: false; offline: boolean; message: string };

export interface AiInterpreter {
  available(): Promise<boolean>;
  read(request: AiRequest): Promise<AiResult>;
}

export function httpInterpreter(endpoint = "/api/design/interpret"): AiInterpreter {
  return {
    async available() {
      try {
        const response = await fetch(endpoint, { method: "GET" });
        if (!response.ok) return false;
        return (await response.json()).available === true;
      } catch {
        return false;
      }
    },

    async read(request) {
      let response: Response;
      try {
        response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      } catch {
        return { ok: false, offline: true, message: "The AI couldn't be reached." };
      }
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        const message = typeof body?.error === "string" ? body.error : `The AI request failed (${response.status}).`;
        // Not set up (503) or no route (404, e.g. a static build): quietly use the rules instead.
        return { ok: false, offline: response.status === 503 || response.status === 404, message };
      }
      const parsed = aiReplySchema.safeParse(body?.reply);
      return parsed.success ? { ok: true, reply: parsed.data } : { ok: false, offline: false, message: "The AI's answer wasn't in the expected shape." };
    },
  };
}
