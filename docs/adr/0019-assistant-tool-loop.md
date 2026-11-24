# ADR 0019 — The assistant: a tool loop over the plan's commands

- Status: accepted.
- Date: 2026-11-24
- Builds on: [ADR 0004](0004-claude-request-reader.md), [ADR 0018](0018-drafted-clone.md)

## Context

The AI Designer read each request once into room goals and brief changes, and offered the result as options (ADR 0004). People want to say "make the kitchen bigger", "add a downstairs toilet" or "swap bedroom 2 and the study", see the plan change, and take it back. ADR 0018 left the agent chat undone.

## Decisions

- **A tool loop on the server, stateless.** Each turn the browser posts the plan, the brief, the selected room and the last few turns of chat text to `/api/design/agent`. The server runs Claude with tools over a private copy of the plan (`server/agent/loop.ts`), streams progress as newline-delimited JSON, and returns the new plan with the list of changes. Nothing is stored between turns. Up to 8 model calls and 50 s a turn.
- **Tools are the only way the agent edits** (`domain/agent/tools.ts`). Each runs the domain's validated commands or the room planner and returns a new plan or a structured failure (`code`, `message`) that goes back to the model so it can retry. The model names rooms by id and says what it wants (a side, a corner, a size, a goal); the tools work out the geometry, so no coordinates come from the model, as before. A change that would alter a pinned room is refused like a planner option is.
- **Honest by construction.** The list under a reply is built from the tools that succeeded, not from the model's words. A part of a request no tool can do is recorded with `report_unsupported` and shown as "Couldn't do"; a turn with no changes says "No changes were made to your plan". Failed attempts are listed too.
- **One turn, one undo step.** The result replaces the plan in a single history entry (`replaceDocument`), so Undo, Redo and the editor's own undo agree; the panel reads each turn's status from the history. If the plan changed while the assistant worked, the result is discarded.
- **The extension point is the tool registry** (`domain/agent/registry.ts`). A tool is a name, a description for the model, a zod input schema and a `run`. Exterior (roof, finish, style) and interior (furnish, paint, floor) tools go in their own modules and are added where `agentRegistry` is built (`server/agent/index.ts`). The loop, the route and the panel need no change.
- **Model.** `claude-sonnet-5-5` by default; `ANTHROPIC_AGENT_MODEL` overrides it. With no `ANTHROPIC_API_KEY` the route answers 503, the Assistant tab shows that it is unavailable, and the quick chat (the rule-based reader, ADR 0004) keeps working.
- **No schema change.** The plan, project and appearance/furniture models are untouched.

## Tools today

`rename_room`, `set_room_type`, `swap_rooms`, `resize_room`, `improve_room` (room planner goals), `add_room` (partition a corner off a rectangular room, with a door), `add_window`, `add_door`, `remove_opening`, `merge_rooms`, `add_floor`, `report_unsupported`.

## Not done

Whole-house layout generation from chat, stairs and furniture tools, streamed reply text, and accepting or rejecting single changes within a turn. See TODOS.md.
