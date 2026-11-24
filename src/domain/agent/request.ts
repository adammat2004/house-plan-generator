import { z } from "zod";
import { houseBriefSchema } from "../brief/schema";
import { planDocumentSchema } from "../plan/schema";

/** What the browser sends for one assistant turn. The server keeps no state between turns. */
export const agentRequestSchema = z.object({
  text: z.string().trim().min(1).max(1000),
  /** Earlier turns, as plain text; the plan summary is rebuilt each turn. */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(20)
    .default([]),
  document: planDocumentSchema,
  brief: houseBriefSchema,
  selectedRoomId: z.string().max(200).nullable().optional(),
});

export type AgentRequest = z.infer<typeof agentRequestSchema>;
