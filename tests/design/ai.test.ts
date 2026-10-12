import { describe, expect, it } from "vitest";
import { DEFAULT_BRIEF } from "@/domain/brief/schema";
import { aiRequestSchema, designContext, interpretationFromReply, type AiReply, type AiRequest } from "@/domain/design/aiInterpretation";
import { interpretRequest } from "@/domain/design/request";
import { createStripPlanner } from "@/domain/design/stripPlanner";
import type { AiInterpreter, AiResult } from "@/editor/state/aiInterpreter";
import { createDesignActions } from "@/editor/state/design";
import { createEditorActions, createEditorStores } from "@/editor/state/stores";
import { apply, level, newHouse } from "../helpers";

const empty: AiReply = {
  reply: "",
  roomChanges: [],
  brief: { bedrooms: null, bathrooms: null, addSpaces: [], removeSpaces: [], addPreferences: [], removePreferences: [], roomSizes: [], houseShape: null, storeys: null },
  unclear: [],
};
const reply = (over: Partial<Omit<AiReply, "brief">> & { brief?: Partial<AiReply["brief"]> } = {}): AiReply => ({ ...empty, ...over, brief: { ...empty.brief, ...over.brief } });

/** A stand-in for Claude that records what it was asked and answers from a script. */
function scripted(answers: Array<AiResult | ((r: AiRequest) => AiResult)>) {
  const asked: AiRequest[] = [];
  const interpreter: AiInterpreter = {
    available: async () => true,
    read: async (request) => {
      asked.push(request);
      const next = answers.shift();
      if (!next) throw new Error("No scripted answer left");
      return typeof next === "function" ? next(request) : next;
    },
  };
  return { interpreter, asked };
}

function setup(interpreter: AiInterpreter | null) {
  const doc = newHouse();
  const stores = createEditorStores(apply(doc, { type: "setRearWall", wallId: level(doc).envelope.wallIds[2] }));
  const actions = createEditorActions(stores);
  const design = createDesignActions(stores, actions, createStripPlanner(), interpreter);
  return { stores, actions, design };
}

const lastSaid = (stores: ReturnType<typeof setup>["stores"]) => stores.session.getState().designer.chat.map((m) => m.text);

describe("reading a model's reply", () => {
  it("keeps only rooms that exist and merges goals for the same room", () => {
    const lvl = level(newHouse());
    const roomId = Object.keys(lvl.rooms)[0];
    const result = interpretationFromReply(
      reply({
        roomChanges: [
          { roomId, goals: ["make_larger"], clause: "bigger" },
          { roomId, goals: ["more_natural_light"], clause: "brighter" },
          { roomId: "made-up", goals: ["add_storage"], clause: "storage in the attic" },
        ],
      }),
      lvl,
      DEFAULT_BRIEF,
      "request",
    );
    expect(result.steps).toEqual([{ kind: "room", roomId, goals: ["make_larger", "more_natural_light"], clause: "bigger" }]);
    expect(result.unclear).toEqual(["storage in the attic"]);
  });

  it("applies brief changes in order, and notes from the brief only ever add", () => {
    const changes = reply({ brief: { bedrooms: 2, addSpaces: ["office"], removeSpaces: ["dining"], addPreferences: ["home_office"], roomSizes: [{ group: "kitchen", size: "generous" }] } });
    const request = interpretationFromReply(changes, null, DEFAULT_BRIEF, "request");
    expect(request.steps.map((s) => s.kind === "brief" && s.describe)).toEqual([
      "The brief now asks for 2 bedrooms",
      "Added a home office to the brief",
      "Removed the dining room from the brief",
      "Added “Home office” to the brief",
      "Kitchen set to generous",
    ]);
    const notes = interpretationFromReply(changes, null, DEFAULT_BRIEF, "instructions");
    expect(notes.steps.map((s) => s.kind === "brief" && s.describe)).toEqual(["Added a home office to the brief", "Added “Home office” to the brief", "Kitchen set to generous"]);
  });

  it("summarises the plan without coordinates, and the request passes the route's checks", () => {
    const lvl = level(newHouse());
    const roomId = Object.keys(lvl.rooms)[0];
    const context = designContext(lvl, DEFAULT_BRIEF, roomId);
    expect(context.rooms[0]).toMatchObject({ id: roomId, name: "Room 1", type: "unspecified", garden: false, doorsTo: [] });
    expect(JSON.stringify(context)).not.toMatch(/"x"|"y"/);
    expect(aiRequestSchema.safeParse({ mode: "request", text: "make it bigger", context }).success).toBe(true);
    expect(aiRequestSchema.safeParse({ mode: "request", text: " ", context }).success).toBe(false);
  });
});

describe("AI Designer with Claude", () => {
  it("sends typed requests to the model and turns its reply into options", async () => {
    const { interpreter, asked } = scripted([
      (r) => ({ ok: true, reply: reply({ reply: "I'll look at making it brighter.", roomChanges: [{ roomId: r.context.selectedRoomId!, goals: ["more_natural_light"], clause: "brighter" }] }) }),
    ]);
    const { stores, actions, design } = setup(interpreter);
    await design.generateLayouts(1);
    const bedroom = Object.values(level(actions.current()).rooms).find((r) => r.type === "primary_bedroom")!;
    actions.select({ kind: "room", id: bedroom.id });
    await design.ask("can this room feel brighter");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ mode: "request", text: "can this room feel brighter", context: { selectedRoomId: bedroom.id } });
    const chat = stores.session.getState().designer.chat;
    expect(chat.map((m) => m.text)).toContain("I'll look at making it brighter.");
    expect(chat.some((m) => m.proposals?.length)).toBe(true);
    expect(stores.session.getState().designer.status).toBe("idle");
  });

  it("reads the brief's notes once into the brief before generating layouts", async () => {
    const { interpreter, asked } = scripted([{ ok: true, reply: reply({ brief: { addSpaces: ["utility"] }, unclear: ["a boot room"] }) }]);
    const { stores, actions, design } = setup(interpreter);
    actions.setBrief({ ...DEFAULT_BRIEF, additionalInstructions: "We'd love a utility and a boot room" });
    await design.generateLayouts();
    expect(asked.map((a) => a.mode)).toEqual(["instructions"]);
    expect(stores.project.getState().brief.requiredSpaces).toContain("utility");
    const notes = stores.session.getState().designer.lastResult!.notes;
    expect(notes[0]).toBe("From your notes: Added a utility room to the brief.");
    expect(notes.join(" ")).toMatch(/boot room/);
    expect(notes.join(" ")).not.toMatch(/no AI read them/);
    // The same notes aren't sent again.
    await design.generateMore();
    expect(asked).toHaveLength(1);
  });

  it("falls back to the built-in reader without comment when the AI isn't set up or fails", async () => {
    const offline = scripted([{ ok: false, offline: true, message: "not set up" }]);
    const a = setup(offline.interpreter);
    await a.design.ask("add a utility room");
    expect(a.stores.project.getState().brief.requiredSpaces).toContain("utility");
    expect(a.stores.session.getState().designer.ai).toBe("off");
    // Once off, it stops asking.
    await a.design.ask("add an office");
    expect(offline.asked).toHaveLength(1);

    const failing = scripted([{ ok: false, offline: false, message: "The AI is busy (rate limited)." }]);
    const b = setup(failing.interpreter);
    await b.design.ask("add a utility room");
    expect(lastSaid(b.stores).join(" ")).not.toMatch(/rate limited|built-in reader/);
    expect(b.stores.project.getState().brief.requiredSpaces).toContain("utility");
  });
});

describe("storeys", () => {
  it("reads two storeys and bungalows, and leaves three storeys unclear", () => {
    const lvl = level(newHouse());
    const read = (text: string, brief = DEFAULT_BRIEF) => interpretRequest(text, lvl, brief, null);
    expect(read("make it a two-storey house").steps).toEqual([{ kind: "brief", patch: { storeys: 2 }, describe: "The brief now asks for a two-storey house, with the bedrooms upstairs", clause: "make it a two-storey house" }]);
    expect(read("put the bedrooms upstairs").steps[0]).toMatchObject({ patch: { storeys: 2 } });
    expect(read("a bungalow please", { ...DEFAULT_BRIEF, storeys: 2 }).steps[0]).toMatchObject({ patch: { storeys: 1 } });
    expect(read("a bungalow please").steps).toEqual([]);
    expect(read("three storeys").unclear).toEqual(["three storeys"]);
  });

  it("takes storeys from Claude's reply, and sees every floor", () => {
    expect(interpretationFromReply(reply({ brief: { storeys: 2 } }), null, DEFAULT_BRIEF, "request").steps[0]).toMatchObject({ patch: { storeys: 2 } });
    const three = interpretationFromReply(reply({ brief: { storeys: 3 } }), null, DEFAULT_BRIEF, "request");
    expect(three.steps).toEqual([]);
    expect(three.unclear[0]).toMatch(/3 storeys/);
    const doc = apply(newHouse(), { type: "addLevel" });
    const context = designContext(doc, DEFAULT_BRIEF, null);
    expect(context.rooms.map((r) => r.floor)).toEqual(["Ground floor", "First floor"]);
    const upstairs = Object.keys(doc.levels[1].rooms)[0];
    const change = interpretationFromReply(reply({ roomChanges: [{ roomId: upstairs, goals: ["make_larger"], clause: "bigger" }] }), doc, DEFAULT_BRIEF, "request");
    expect(change.steps[0]).toMatchObject({ kind: "room", roomId: upstairs });
  });
});
