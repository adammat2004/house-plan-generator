"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, ChevronRightIcon, RedoIcon, SendIcon, UndoIcon, WarningIcon } from "@/components/ui/icons";
import { assistant, useAssistantState, useDocumentState, useSessionState } from "../../state/editor";
import type { DesignView, Workspace } from "../../state/stores";
import type { AssistantTurn } from "../../state/assistant";

/** What the assistant can be asked, shown until the first message. */
export const ASSISTANT_EXAMPLES = ["Make the kitchen bigger", "Add a downstairs toilet", "Swap bedroom 2 and the study", "Add a window to the living room"];

/**
 * The assistant beside the plan: a chat that keeps its history, and under each
 * reply the exact changes made, with Undo and Keep. Changes are applied at
 * once as one undo step; nothing is hidden and nothing is claimed that a
 * tool didn't do.
 */
export function AssistantTab({ onUseQuickChat, canEdit = true }: { onUseQuickChat: () => void; canEdit?: boolean }) {
  const step = useSessionState((s) => stepOf(s.workspace, s.designView));
  const turns = useAssistantState((s) => s.turns);
  const running = useAssistantState((s) => s.running);
  const pending = useDocumentState(() => assistant.hasPending());
  const available = useAssistantState((s) => s.available);
  const [text, setText] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const progress = turns.at(-1)?.steps.length ?? 0;

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [turns.length, running, progress]);

  const send = (value = text) => {
    if (!value.trim() || running || pending || available === "no" || !canEdit) return;
    setText("");
    void assistant.ask(value);
  };

  return (
    <>
      <div className="ai-log" ref={log} aria-live="polite" data-testid="assistant-log">
        {available === "no" && (
          <div className="assistant-unavailable" data-testid="assistant-unavailable">
            <p>
              <WarningIcon width={16} height={16} /> The assistant isn&apos;t available right now.
            </p>
            <p className="ai-note">You can still make simple changes with the quick chat.</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={onUseQuickChat}>
              Use the quick chat
            </button>
          </div>
        )}
        {!canEdit && (
          <div className="assistant-unavailable" data-testid="assistant-step-note">
            <p>
              <WarningIcon width={16} height={16} /> I can&apos;t make changes in {step} yet.
            </p>
            <p className="ai-note">For now I edit a plan in Refine: rooms, doors, windows and floors. Open a layout in Refine and ask me there.</p>
          </div>
        )}
        {canEdit && available !== "no" && !turns.length && (
          <div className="ai-intro">
            <p className="ai-note">Tell me what to change and I&apos;ll change the plan. You can undo any step.</p>
            <div className="ai-examples">
              {ASSISTANT_EXAMPLES.map((e) => (
                <button key={e} type="button" className="suggestion-row" disabled={running} onClick={() => send(e)}>
                  {e}
                  <ChevronRightIcon width={16} height={16} />
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((turn) => (
          <Turn key={turn.id} turn={turn} />
        ))}
      </div>
      <form
        className="ai-compose"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          aria-label="Ask the assistant"
          placeholder={available === "no" ? "The assistant isn't available" : pending ? "Accept or discard the changes first" : canEdit ? "Ask for a change…" : "Changes open up in Refine"}
          rows={3}
          value={text}
          maxLength={1000}
          disabled={available === "no" || !canEdit || pending}
          data-testid="assistant-input"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="submit" className="ai-send" aria-label="Send" disabled={!text.trim() || running || pending || available === "no" || !canEdit} data-testid="assistant-send">
          <SendIcon width={18} height={18} />
        </button>
      </form>
    </>
  );
}

function Turn({ turn }: { turn: AssistantTurn }) {
  // Read from the history, so the editor's own undo and redo keep the buttons right.
  const status = useDocumentState(() => assistant.statusOf(turn));
  return (
    <>
      <p className="ai-bubble" data-testid="assistant-user">
        {turn.text}
      </p>
      <div className="ai-reply" data-testid="assistant-turn">
        {turn.status === "running" && (
          <>
            {turn.steps.length > 0 && (
              <ul className="assistant-steps" data-testid="assistant-steps">
                {turn.steps.map((s) => (
                  <li key={s.id} className={s.ok ? undefined : "is-failed"}>
                    {s.text}
                  </li>
                ))}
              </ul>
            )}
            <p className="ai-thinking" data-testid="assistant-working">
              Working on it…
            </p>
          </>
        )}
        {turn.status === "error" && (
          <p className="assistant-error" role="alert" data-testid="assistant-error">
            {turn.error}
          </p>
        )}
        {turn.status === "done" && (
          <>
            <p data-testid="assistant-reply">{turn.reply}</p>
            {turn.changes.length > 0 ? (
              <div className={`assistant-changes is-${status}`} data-testid="assistant-changes">
                <ul>
                  {turn.changes.map((c, i) => (
                    <li key={i}>{c.summary}</li>
                  ))}
                </ul>
                <div className="assistant-actions">
                    {status === "pending" && (
                      <>
                        <span className="proposal-state is-pending" data-testid="assistant-pending">
                          Preview on the plan: not applied yet
                        </span>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => assistant.accept(turn.id)} data-testid="assistant-accept">
                          <CheckIcon width={14} height={14} /> Accept all
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => assistant.discard(turn.id)} data-testid="assistant-discard">
                          Discard
                        </button>
                      </>
                    )}
                    {status === "discarded" && (
                      <span className="proposal-state is-stale" data-testid="assistant-discarded">
                        Discarded: the plan was not changed
                      </span>
                    )}
                    {status === "applied" && (
                    <>
                      <span className="proposal-state">
                        <CheckIcon width={14} height={14} /> {turn.kept ? "Kept" : "Applied"}
                      </span>
                      {!turn.kept && (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => assistant.keep(turn.id)} data-testid="assistant-keep">
                          Keep
                        </button>
                      )}
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => assistant.undo(turn.id)} data-testid="assistant-undo">
                        <UndoIcon width={14} height={14} /> Undo
                      </button>
                    </>
                  )}
                  {status === "reverted" && (
                    <>
                      <span className="proposal-state is-stale">Undone</span>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => assistant.redo(turn.id)} data-testid="assistant-redo">
                        <RedoIcon width={14} height={14} /> Redo
                      </button>
                    </>
                  )}
                  {status === "moved-on" && <span className="proposal-state is-stale">The plan has changed since. Use undo to step back.</span>}
                </div>
              </div>
            ) : (
              <p className="assistant-none" data-testid="assistant-no-changes">
                No changes were made to your plan.
              </p>
            )}
            {turn.error && (
              <p className="assistant-error" role="alert">
                {turn.error}
              </p>
            )}
            {turn.unsupported.length > 0 && (
              <div className="assistant-notes" data-testid="assistant-unsupported">
                <p className="ai-note">Couldn&apos;t do:</p>
                <ul>
                  {turn.unsupported.map((u, i) => (
                    <li key={i}>
                      <strong>{u.request}</strong>: {u.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turn.failures.length > 0 && (
              <details className="assistant-notes" data-testid="assistant-failures">
                <summary>{turn.failures.length === 1 ? "1 attempt didn't work" : `${turn.failures.length} attempts didn't work`}</summary>
                <ul>
                  {turn.failures.map((f, i) => (
                    <li key={i}>{f.message}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </>
  );
}

const stepOf = (workspace: Workspace, view: DesignView) => (workspace === "site" ? "Map" : workspace === "brief" ? "Requirements" : workspace === "review" ? "Review" : view === "plan" ? "Refine" : "Explore");
