"use client";

import { useState, type FormEvent } from "react";
import { roomBounds } from "@/domain/design/analysis";
import { areaDeltaText } from "@/domain/design/impact";
import { roomInsight } from "@/domain/design/insights";
import { ROOM_GOAL_LABEL, type RoomGoal } from "@/domain/design/intent";
import { levelOf } from "@/domain/plan/levels";
import type { Level, RoomType } from "@/domain/plan/types";
import {
  ArmchairIcon,
  AreaIcon,
  ArrowRightIcon,
  BathIcon,
  ChevronRightIcon,
  LeafIcon,
  SendIcon,
  SparkleIcon,
  SunIcon,
  VariationsIcon,
  WarningIcon,
} from "@/components/ui/icons";
import { design, useDocumentState, useRoomOptions, useSessionState } from "../../state/editor";
import type { Proposal } from "../../state/stores";
import type { GoalOptions } from "../../state/roomOptions";
import { ConceptPreview } from "../designer/ConceptPreview";
import { Section } from "./frame";

const GOAL_ICON: Partial<Record<RoomGoal, typeof SunIcon>> = {
  make_larger: AreaIcon,
  make_smaller: AreaIcon,
  more_natural_light: SunIcon,
  increase_garden_connection: LeafIcon,
  make_open_plan: VariationsIcon,
  add_storage: ArmchairIcon,
  add_kitchen_island: ArmchairIcon,
  create_dining_zone: ArmchairIcon,
  add_ensuite: BathIcon,
};

/** The room's options from the planner, once worked out for this room on this plan. */
function useGoals(roomId: string): GoalOptions[] | null {
  const mine = useRoomOptions((s) => s.roomId === roomId);
  const goals = useRoomOptions((s) => s.goals);
  return mine ? goals : null;
}

/** The size change an option makes, or how many there are when none changes the size. */
function gainOf(g: GoalOptions): string | null {
  const best = g.proposals[0];
  const delta = best?.impact ? areaDeltaText(best.impact) : null;
  return delta ?? (g.proposals.length > 1 ? `${g.proposals.length} options` : null);
}

/**
 * What people most often want for this kind of room. Each one has already
 * been tried on the plan: it says what it would do, or why it can't, and
 * picking it shows its options on the plan without changing anything.
 */
export function QuickActions({ roomId, type, picked, onPick }: { roomId: string; type: RoomType; picked: RoomGoal | null; onPick: (goal: RoomGoal | null) => void }) {
  const goals = useGoals(roomId);
  const running = useSessionState((s) => s.designer.status === "running");
  if (!goals) return null;
  return (
    <Section title="Quick actions">
      <div className="quick-actions">
        {goals.map((g) => {
          const Icon = GOAL_ICON[g.goal] ?? SparkleIcon;
          const ready = g.status === "ready";
          const gain = ready ? gainOf(g) : null;
          return (
            <button
              key={g.goal}
              type="button"
              className={`quick-action${picked === g.goal ? " is-active" : ""}${g.status === "none" ? " is-unavailable" : ""}`}
              disabled={!ready || running}
              aria-pressed={picked === g.goal}
              title={g.status === "none" ? (g.reason ?? "Not possible in this room as it is.") : undefined}
              onClick={() => {
                onPick(picked === g.goal ? null : g.goal);
                if (picked !== g.goal && g.proposals[0]) design.stage(g.proposals[0].id);
              }}
              data-testid={`suggest-${g.goal}`}
            >
              <Icon width={18} height={18} />
              <span>
                {ROOM_GOAL_LABEL[g.goal]}
                {g.status === "none" && <small className="quick-action-why">{g.reason ?? "Not possible here as it is"}</small>}
              </span>
              {g.status === "checking" ? (
                <small className="quick-action-meta">Checking…</small>
              ) : gain ? (
                <small className="quick-action-meta is-gain">{gain}</small>
              ) : null}
              {ready && <ChevronRightIcon width={16} height={16} />}
            </button>
          );
        })}
      </div>
      {type === "unspecified" && <p className="field-hint">Say what the room is for (under This room) for ideas that suit it.</p>}
    </Section>
  );
}

/**
 * The AI Designer for this room: the one thing most worth changing, if
 * anything, and options to look at on the plan, compare and apply. Every
 * option comes from the planner and every number from the plans; a change
 * the planner couldn't make is never offered.
 */
export function AiOptions({ level, roomId, picked, onPick }: { level: Level; roomId: string; picked: RoomGoal | null; onPick: (goal: RoomGoal | null) => void }) {
  const goals = useGoals(roomId);
  const stagedId = useDocumentState((s) => s.staged?.proposalId ?? null);
  const [asked, setAsked] = useState<Proposal[]>([]);
  const ready = goals?.filter((g) => g.status === "ready") ?? [];
  const checking = !goals || goals.some((g) => g.status === "checking");
  const insight = goals && !checking
    ? roomInsight(
        level,
        roomId,
        ready.flatMap((g) => g.proposals.slice(0, 1).map((p) => ({ goal: g.goal, title: p.title, summary: p.summary, impact: p.impact ?? null }))),
      )
    : null;
  // A picked quick action shows its own options; otherwise the best option of each idea, the insight's first.
  const focus = picked ?? null;
  const cards: Proposal[] = asked.length
    ? asked.slice(0, 3)
    : focus
      ? (ready.find((g) => g.goal === focus)?.proposals ?? []).slice(0, 3)
      : [...ready].sort((a, b) => (a.goal === insight?.goal ? -1 : b.goal === insight?.goal ? 1 : 0)).map((g) => g.proposals[0]).slice(0, 3);
  const lettered = cards.map((p, i) => ({ p, letter: "ABC"[i] }));
  const chosen = lettered.find(({ p }) => p.id === stagedId) ?? null;

  return (
    <div className="card-section ai-options" data-testid="room-ai-options">
      <div className="section-head">
        <h3>AI Designer</h3>
        <button type="button" className="link-btn" onClick={() => void design.openRoomVariations(roomId)} data-testid="room-variations">
          See all
        </button>
      </div>
      {insight && (
        <p className="insight-card" data-testid="room-insight">
          <SparkleIcon width={18} height={18} />
          <span>{insight.text}</span>
        </p>
      )}
      {checking && !cards.length && <p className="field-hint">Looking for changes that would work here…</p>}
      {!checking && !cards.length && <p className="field-hint">No changes found for this room as it is. Try asking below, or look at variations.</p>}
      {cards.length > 0 && (
        <div className="option-cards" role="radiogroup" aria-label="Options for this room">
          {lettered.map(({ p, letter }) => (
            <OptionCard key={p.id} proposal={p} letter={letter} active={p.id === stagedId} />
          ))}
        </div>
      )}
      {cards.length > 0 && (
        // Stays in view at the foot of the panel while the options above scroll.
        <div className="inspector-sticky-footer">
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!chosen}
          onClick={() => {
            if (!chosen) return;
            if (design.applyProposal(chosen.p.id)) {
              onPick(null);
              setAsked([]);
            }
          }}
          data-testid="apply-option"
        >
          {chosen ? `Apply ${chosen.letter}` : "Pick an option to see it on the plan"}
          {chosen && <ArrowRightIcon width={16} height={16} />}
        </button>
        </div>
      )}
      {focus && (
        <button type="button" className="link-btn" onClick={() => onPick(null)}>
          Show other ideas
        </button>
      )}
      <AskBox roomName={level.rooms[roomId]?.name ?? "this room"} onAnswer={(proposals) => {
        setAsked(proposals.filter((p) => p.roomIds.includes(roomId) || levelOf(p.document, roomId)));
        onPick(null);
        if (proposals[0]) design.stage(proposals[0].id);
      }} />
    </div>
  );
}

/** One option: a picture of the room after it, its gain, and anything it would make worse. */
function OptionCard({ proposal, letter, active }: { proposal: Proposal; letter: string; active: boolean }) {
  const status = useDocumentState(() => design.statusOf(proposal));
  const level = (proposal.roomIds[0] && levelOf(proposal.document, proposal.roomIds[0])) || proposal.document.levels[0];
  const b = proposal.roomIds[0] ? roomBounds(level, proposal.impact?.afterRoomId ?? proposal.roomIds[0]) : null;
  const focus = b ? { minX: b.minX - 1.2, minY: b.minY - 1.2, maxX: b.maxX + 1.2, maxY: b.maxY + 1.2 } : undefined;
  const gain = proposal.impact ? areaDeltaText(proposal.impact) : null;
  const worse = proposal.impact?.introduced ?? [];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`option-card${active ? " is-active" : ""}`}
      disabled={status === "stale"}
      onClick={() => (active ? design.unstageOption() : design.stage(proposal.id, letter))}
      data-testid="room-option"
    >
      <span className="option-picture">
        <ConceptPreview level={level} plan={proposal.document} focus={focus} margin={0.2} labels={false} site={false} highlight={proposal.roomIds} className="option-preview" />
      </span>
      <span className="option-title">
        {letter}. {proposal.title}
      </span>
      <span className="option-meta">
        {gain && <strong>{gain}</strong>}
        {worse.length > 0 && (
          <span className="option-worse" title={worse.map((f) => f.message).join(" ")}>
            <WarningIcon width={13} height={13} /> To check
          </span>
        )}
        {status === "applied" && <span>Applied</span>}
      </span>
    </button>
  );
}

/** A change in your own words, about this room. */
function AskBox({ roomName, onAnswer }: { roomName: string; onAnswer: (proposals: Proposal[]) => void }) {
  const [text, setText] = useState("");
  const running = useSessionState((s) => s.designer.status === "running");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const request = text.trim();
    if (!request || running) return;
    setText("");
    onAnswer(await design.ask(request));
  };
  return (
    <form className="room-ask" onSubmit={(e) => void submit(e)}>
      <input
        value={text}
        maxLength={300}
        placeholder={`Ask for a change to the ${roomName.toLowerCase()}…`}
        aria-label={`Ask for a change to the ${roomName.toLowerCase()}`}
        onChange={(e) => setText(e.currentTarget.value)}
        data-testid="room-ask-input"
      />
      <button type="submit" disabled={!text.trim() || running} aria-label="Ask" data-testid="room-ask-send">
        <SendIcon width={16} height={16} />
      </button>
    </form>
  );
}
