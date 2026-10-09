# ADR 0004 — Claude reads requests and brief notes

- Status: accepted. Implemented 2026-10-08.
- Date: 2026-10-08
- Builds on: [ADR 0002](0002-project-variants-and-design-intent.md) (an LLM may only produce `DesignIntent`), [ADR 0003](0003-furniture.md)

## Context

ADR 0002 left a slot for a language model between the user's words and the planners. Until now two things filled it, or didn't:

- A rule-based reader (`design/request.ts`) understood typed requests through keyword patterns.
- Nothing read the brief's free-text notes at all.

## Decisions

### The model reads; the planners still draw

Claude turns text into the same structured steps the rule-based reader produces:

- room goals for an existing room, which the room planner turns into options;
- brief changes: counts, spaces, preferences and room sizes.

It never sees or returns coordinates. Its reply is checked before anything happens:

- Unknown room ids become "unclear".
- Values outside the vocabulary are rejected by the schema.
- Counts are clamped to the brief's limits.

Every geometric result still comes from `applyCommand`, so a wrong reading can at worst offer an unhelpful option. It can never produce an invalid plan.

### Contract (`src/domain/design/aiInterpretation.ts`, pure)

- `designContextSchema`: the plan as the model sees it. For each room: its id, name, type, area, whether it is on the garden side, and the rooms its doors lead to. Also the brief and the selected room.
- `aiReplySchema`: the reply. Every field is required, so it compiles to a strict structured output.
- `interpretationFromReply`: turns a reply into `RequestStep[]` and drops whatever doesn't fit the plan.
- **Two modes:**
  - `request` is a message typed in the AI Designer.
  - `instructions` is the brief's notes, read when layouts are generated. These can only add to the brief: no removals, no lower counts, and no room changes, because no layout exists yet. This keeps ADR 0002's rule that free text supplements the structured brief and never replaces it.

### Server side (`src/server/designInterpreter.ts`, `src/app/api/design/interpret/route.ts`)

- **Key stays on the server.** The API key is read from `ANTHROPIC_API_KEY` in `.env.local`, which git ignores, and never reaches the browser.
- **Endpoints.** `GET` reports whether the AI layer is set up. `POST` validates the request with zod and then calls Claude.
- **Model settings:**
  - `claude-opus-5`, adaptive thinking at `effort: "low"`, which is enough for reading short text into a fixed schema;
  - `client.beta.messages.parse` with a zod output format;
  - a stable system prompt, cached.
- **Refusals.** Server-side `fallbacks: "default"` re-runs a refused request on Anthropic's recommended model. A refusal that still stands is reported to the user.
- **Rate limit.** In memory: 30 requests per visitor per 10 minutes. The app has no accounts, so this is what keeps a deployed copy from being used to spend the key.

### Client side

- `editor/state/aiInterpreter.ts` calls the route.
- `createDesignActions` takes an optional interpreter, so tests use a scripted stand-in.
- **Fallback:**
  - If the route says the AI layer isn't set up, the editor quietly uses the rule-based reader for the rest of the session.
  - If a call fails (rate limit, network, bad answer), the user is told and the rule-based reader handles that request.
- **Notes are read once per text.** Generating again doesn't call the model again.
- The AI Designer and the brief's notes field say whether Claude or the built-in reader is in use.
- Playwright starts its server with an empty `ANTHROPIC_API_KEY`, which `.env.local` cannot override. Browser tests therefore never call Claude or spend money.

## Consequences

- **Speed.** A request takes several seconds (about 8 s in the first live test) instead of being instant. The panel says it is reading the request.
- **Cost.** Each request costs a few cents at Opus 5 rates. Reading the notes adds one call the first time layouts are generated after the notes change.
- **Single machine.** The rate limit is per server process. A deployment with several instances, or one facing the public, should move it to shared storage and add real authentication.
