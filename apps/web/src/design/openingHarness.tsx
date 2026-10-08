/**
 * Opening a Mate's conversation, its footer frame by frame: the page standing in while the
 * conversation is read (the route's opening view, a Mate's own page), then the conversation with
 * its agents' sign-in still being read, then the answer. The footer at each step is the one the
 * app draws — `ConversationFooterStandIn`, then `conversationFooter` over HQ's word and the Mate's
 * answer — so a per-frame sampler can say what a person saw.
 *
 * Served by the dev server at `/design-opening.html` (`?theme=dark`; `?hq=` HQ's word, `you`,
 * `someone`, `nobody-yet` or nothing; `?answer=` the Mate's answer, `someone` by default;
 * `?thread=<ms>` when the conversation is read, 600 by default; `?auth=<ms>` when its sign-in is,
 * 900 by default; `?draft=` the conversation's draft, its lines split by newlines).
 * `window.__opening.frames` holds one sample per frame from the load: what the footer showed and
 * whether a field had the focus.
 *
 * Fixtures only. Nothing here ships — `design-opening.html` is not `index.html`, and no route
 * imports this module.
 */
import {
  conversationFooter,
  type ConversationWriter,
} from "@t3tools/client-runtime/zerops/conversationWriter";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ComposerRoomHeld, ComposerStandInDock } from "~/components/chat/ComposerStandIn";
const HQ_SAID_READ_ONLY = {
  notice: "Signed in by another project member — only they can run this agent.",
  waitingLabel: "Waiting for the agent's owner",
};
import { ConversationFooterStandIn } from "~/components/zerops/ConversationFooterStandIn";
import { ZeropsReadOnlyConversationFooter } from "~/components/zerops/ZeropsReadOnlyConversationFooter";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import {
  ConversationOpeningProvider,
  ConversationOpeningStage,
} from "~/components/chat/ConversationOpeningStage";
import { ConversationStripView } from "~/components/chat/ConversationStrip";
import { TooltipProvider } from "~/components/ui/tooltip";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
type Answer = Exclude<ConversationWriter["kind"], "unknown">;
const ANSWERS: ReadonlyArray<Answer> = ["you", "someone", "nobody-yet"];
const asAnswer = (value: string | null): Answer | undefined =>
  ANSWERS.find((answer) => answer === value);
const HQ_WORD = asAnswer(params.get("hq"));
const HQ: ConversationWriter = { kind: HQ_WORD ?? "unknown" };
const ANSWER = asAnswer(params.get("answer")) ?? "someone";
const THREAD_MS = Number(params.get("thread") ?? 600);
const AUTH_MS = Math.max(THREAD_MS, Number(params.get("auth") ?? 900));
/** The conversation's draft, `\n` for its lines (`?draft=`). */
const DRAFT = params.get("draft") ?? "";
const SOURCE = params.get("source");
const nothing = () => undefined;

const HARNESS_MATE = {
  name: "Fen",
  tint: "olive",
  shape: "flower",
  connected: true,
  project: "Harness",
} as const;

type Phase = "opening" | "conversation" | "answered";

/** The conversation's footer, as ChatView chooses it. */
function ConversationFooter({ writer }: { readonly writer: ConversationWriter }) {
  const footer = conversationFooter(writer, HQ);
  if (footer === "read-only") {
    return (
      <ComposerStandInDock>
        <ZeropsReadOnlyConversationFooter
          onSignIn={writer.kind === "someone" ? nothing : undefined}
          pendingApprovals={[]}
          pendingUserInputs={[]}
          readOnly={HQ_SAID_READ_ONLY}
        />
      </ComposerStandInDock>
    );
  }
  if (footer === "held") {
    return (
      <ComposerStandInDock held>
        <ComposerRoomHeld draft={DRAFT} />
      </ComposerStandInDock>
    );
  }
  return (
    <ComposerStandInDock>
      <textarea aria-label="Message" className="block w-full" defaultValue={DRAFT} />
    </ComposerStandInDock>
  );
}

function Harness() {
  const [phase, setPhase] = useState<Phase>(THREAD_MS === 0 ? "conversation" : "opening");
  useEffect(() => {
    const thread = setTimeout(() => setPhase("conversation"), THREAD_MS);
    const auth = setTimeout(() => setPhase("answered"), AUTH_MS);
    return () => {
      clearTimeout(thread);
      clearTimeout(auth);
    };
  }, []);
  return (
    <TooltipProvider>
      <ConversationOpeningProvider>
        <div
          className="flex h-svh flex-col bg-background text-foreground"
          data-phase={phase}
          data-chat-workspace-drop-target=""
        >
          <header className="flex h-14 items-center px-6" data-chat-header="">
            <ConversationStripView
              mate={{
                name: "Fen",
                tint: "olive",
                shape: "flower",
                face: "idle",
                open: true,
                threadId: null,
                tooltip: null,
              }}
              chats={null}
              crew={null}
              renameField={null}
              renderCrewmateMenu={() => null}
              onOpen={nothing}
              onCloseChat={nothing}
              onRename={null}
            />
          </header>
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col" data-conversation-content="">
              {params.has("empty") ? (
                <MateEmptyStateView
                  faceSlot={null}
                  mate={HARNESS_MATE}
                  phase={null}
                  signIn={null}
                  signInRequired={false}
                  unknown={null}
                />
              ) : (
                <p className="m-auto text-sm text-muted-foreground">Fen's conversation</p>
              )}
            </div>
            <ConversationOpeningStage
              ready={phase !== "opening"}
              readPending={!params.has("held")}
              name="Fen"
              mate={HARNESS_MATE}
            >
              {phase === "opening" && SOURCE !== null ? (
                <MateEmptyStateView
                  mate={HARNESS_MATE}
                  phase={null}
                  coming={{
                    kind: SOURCE === "restart" ? "reaching" : "coming",
                    restarting: SOURCE === "restart",
                    headline: SOURCE === "restart" ? "Fen is restarting" : "Fen is standing up",
                    below: (
                      <ol className="grid gap-3">
                        {[
                          "Workspace",
                          "Repository",
                          "Dependencies",
                          "Services",
                          "Agent",
                          "Conversation",
                        ].map((step) => (
                          <li key={step}>Preparing {step.toLowerCase()}</li>
                        ))}
                      </ol>
                    ),
                  }}
                  signIn={null}
                  signInRequired={false}
                  unknown={null}
                />
              ) : undefined}
            </ConversationOpeningStage>
            <div data-conversation-footer="">
              {phase === "opening" ? (
                <ConversationFooterStandIn key="opening" draft={DRAFT} />
              ) : (
                <ConversationFooter
                  key="conversation"
                  writer={phase === "answered" ? { kind: ANSWER } : { kind: "unknown" }}
                />
              )}
            </div>
          </div>
        </div>
      </ConversationOpeningProvider>
    </TooltipProvider>
  );
}

/** One sample a frame: what the footer shows, and whether a field holds the focus. */
interface FooterFrame {
  readonly t: number;
  readonly phase: string;
  readonly shows: "composer" | "strip" | "held" | "nothing";
  readonly focused: boolean;
  readonly top: number | null;
}

const frames: FooterFrame[] = [];
const start = performance.now();
const visible = (element: Element | null): boolean =>
  element !== null && getComputedStyle(element).visibility !== "hidden";
const sample = () => {
  const field = document.querySelector("[data-composer-stand-in] textarea");
  const strip = document.querySelector("[data-zerops-read-only-conversation]");
  const held = document.querySelector("[data-composer-room-held]");
  const shell = document.querySelector('[data-composer-stand-in] [data-slot="composer-shell"]');
  frames.push({
    t: Math.round(performance.now() - start),
    phase: document.querySelector("[data-phase]")?.getAttribute("data-phase") ?? "",
    shows: visible(field)
      ? "composer"
      : visible(strip)
        ? "strip"
        : held !== null
          ? "held"
          : "nothing",
    focused: document.activeElement instanceof HTMLTextAreaElement,
    top: shell === null ? null : Math.round(shell.getBoundingClientRect().top),
  });
  if (performance.now() - start < AUTH_MS + 500) requestAnimationFrame(sample);
};
requestAnimationFrame(sample);
(window as unknown as { __opening: { frames: FooterFrame[] } }).__opening = { frames };

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
