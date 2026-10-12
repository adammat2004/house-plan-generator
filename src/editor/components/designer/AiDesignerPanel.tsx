"use client";

import { levelOf } from "@/domain/plan/levels";
import { useEffect, useRef, useState } from "react";
import { assessHouse } from "@/domain/design/analysis";
import { ROOM_GOAL_LABEL, suggestedGoals } from "@/domain/design/intent";
import { planSuggestions } from "@/domain/design/suggestions";
import { IconButton } from "@/components/ui/controls";
import { CheckIcon, ChevronRightIcon, CloseIcon, SendIcon, SparkleIcon } from "@/components/ui/icons";
import { useAreaText } from "@/components/units";
import { design, editor, useDocumentState, useSessionState } from "../../state/editor";
import type { ChatMessage, Proposal } from "../../state/stores";
import { showConcepts } from "../shell/tools";
import { PlanThumbnail } from "./PlanThumbnail";

type Tab = "chat" | "suggestions";

/**
 * The AI Designer beside a plan in Designs. Requests become structured
 * intents for the planners; room changes come back as options to apply or
 * keep, never as silent edits.
 */
export function AiDesignerPanel() {
  const workspace = useSessionState((s) => s.workspace);
  const view = useSessionState((s) => s.designView);
  const open = useSessionState((s) => s.designer.panelOpen);
  if (workspace !== "design" || view !== "plan") return null;
  if (!open) {
    return (
      <button type="button" className="ai-launcher floating" onClick={() => editor.setDesigner({ panelOpen: true })} data-testid="open-ai">
        <SparkleIcon width={18} height={18} /> AI Designer
      </button>
    );
  }
  return <Panel />;
}

function Panel() {
  const [tab, setTab] = useState<Tab>("chat");
  const chat = useSessionState((s) => s.designer.chat);
  const running = useSessionState((s) => s.designer.status === "running");
  const ai = useSessionState((s) => s.designer.ai);
  const selection = useSessionState((s) => s.selection);
  const room = useDocumentState((s) => (selection?.kind === "room" ? levelOf(s.history.present, selection.id)?.rooms[selection.id] : undefined));
  // The whole house, whichever floor is on show.
  const plan = useDocumentState((s) => s.history.present);
  const facts = assessHouse(plan);
  const areaText = useAreaText();
  const examples = planSuggestions(plan);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);

  // Keep the latest message in view.
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [chat.length, running]);

  const send = (value = text) => {
    if (!value.trim() || running) return;
    setTab("chat");
    setText("");
    void design.ask(value);
  };

  return (
    <aside className="ai-panel floating" aria-label="AI Designer" data-testid="ai-panel">
      <header className="ai-header">
        <h2>
          <SparkleIcon width={20} height={20} /> AI Designer
        </h2>
        <IconButton label="Close AI Designer" onClick={() => editor.setDesigner({ panelOpen: false })} data-testid="close-ai">
          <CloseIcon width={18} height={18} />
        </IconButton>
      </header>
      <div className="panel-tabs" role="tablist">
        {(["chat", "suggestions"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "is-active" : undefined} onClick={() => setTab(t)} data-testid={`ai-tab-${t}`}>
            {t === "chat" ? "Chat" : "Suggestions"}
          </button>
        ))}
      </div>

      {tab === "chat" ? (
        <div className="ai-log" ref={log} aria-live="polite" data-testid="ai-log">
          {!chat.length && (
            <div className="ai-intro">
              <p className="ai-summary" data-testid="ai-summary">
                {areaText(facts.totalArea)} · {facts.bedrooms} bed · {facts.bathrooms} bath{facts.storeys ? ` · ${facts.storeys} storeys` : ""}
              </p>
              <p className="ai-note">Try a change, or describe your own below.</p>
              <div className="ai-examples">
                {examples.map((e) => (
                  <button key={e} type="button" className="suggestion-row" onClick={() => send(e)}>
                    {e}
                    <ChevronRightIcon width={16} height={16} />
                  </button>
                ))}
              </div>
            </div>
          )}
          {chat.map((m) => (
            <Message key={m.id} message={m} />
          ))}
          {running && <p className="ai-thinking">{ai === "available" ? "Reading your request…" : "Working on it…"}</p>}
        </div>
      ) : (
        <div className="ai-log">
          {room && selection?.kind === "room" ? (
            <>
              <p className="ai-note">Ideas for {room.name.toLowerCase()}:</p>
              <div className="suggestion-list">
                {suggestedGoals(room.type).map((goal) => (
                  <button
                    key={goal}
                    type="button"
                    className="suggestion-row"
                    disabled={running}
                    onClick={() => {
                      setTab("chat");
                      void design.redesignRoom(selection.id, [goal]);
                    }}
                    data-testid={`ai-suggest-${goal}`}
                  >
                    {ROOM_GOAL_LABEL[goal]}
                    <ChevronRightIcon width={16} height={16} />
                  </button>
                ))}
                <button
                  type="button"
                  className="suggestion-row"
                  disabled={running}
                  onClick={() => {
                    setTab("chat");
                    void design.openRoomVariations(selection.id);
                  }}
                >
                  Variations of this room
                  <ChevronRightIcon width={16} height={16} />
                </button>
              </div>
            </>
          ) : (
            <p className="ai-note">Select a room on the plan to see ideas for it.</p>
          )}
          <p className="ai-note">For the whole house:</p>
          <div className="suggestion-list">
            <button
              type="button"
              className="suggestion-row"
              disabled={running}
              onClick={() => {
                showConcepts();
                void design.generateMore();
              }}
            >
              More layout concepts
              <ChevronRightIcon width={16} height={16} />
            </button>
          </div>
        </div>
      )}

      <form
        className="ai-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Tell me what you want to change"
          placeholder="Tell me what you want to change…"
          rows={3}
          value={text}
          maxLength={500}
          data-testid="ai-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="ai-send" aria-label="Send" disabled={!text.trim() || running} data-testid="ai-send">
          <SendIcon width={18} height={18} />
        </button>
      </form>
    </aside>
  );
}

function Message({ message }: { message: ChatMessage }) {
  if (message.role === "user") return <p className="ai-bubble">{message.text}</p>;
  return (
    <div className="ai-reply">
      <p>{message.text}</p>
      {message.proposals?.map((p) => (
        <ProposalCard key={p.id} proposal={p} />
      ))}
      {message.offerGenerate && (
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={() => {
            showConcepts();
            void design.generateLayouts();
          }}
          data-testid="ai-generate"
        >
          <SparkleIcon width={16} height={16} /> Generate new layouts
        </button>
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: Proposal }) {
  // Worked out from the history, so undoing an applied option offers it again.
  const status = useDocumentState(() => design.statusOf(proposal));
  const stale = status === "stale";
  return (
    <div className={`proposal is-${status}`} data-testid="proposal">
      <PlanThumbnail level={(proposal.roomIds[0] && levelOf(proposal.document, proposal.roomIds[0])) || proposal.document.levels[0]} plan={proposal.document} palette="warm" className="proposal-thumb" highlight={proposal.roomIds} pad={0.4} />
      <p>{proposal.summary}</p>
      {status === "applied" ? (
        <span className="proposal-state">
          <CheckIcon width={14} height={14} /> Applied
        </span>
      ) : status === "saved" ? (
        <span className="proposal-state">
          <CheckIcon width={14} height={14} /> Saved as a concept
        </span>
      ) : stale ? (
        <span className="proposal-state is-stale">The plan has changed since; ask again.</span>
      ) : (
        <div className="proposal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => design.applyProposal(proposal.id)} data-testid="apply-proposal">
            Apply
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => design.saveProposal(proposal.id)} data-testid="save-proposal">
            Save as concept
          </button>
        </div>
      )}
    </div>
  );
}
