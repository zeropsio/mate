/**
 * Opening a Mate's conversation, its footer frame by frame: the page standing in while the
 * conversation is read (the route's opening view, a Mate's own page), then the conversation with
 * its agents' sign-in still being read, then the answer. The footer at each step is the one the
 * app draws — `ConversationFooterStandIn` over this browser's remembered answer, then
 * `conversationFooter` over the live one — so a per-frame sampler can say what a person saw.
 *
 * Served by the dev server at `/design-opening.html` (`?theme=dark`; `?remembered=` `you`,
 * `someone`, `nobody-yet` or nothing; `?answer=` the live answer, `someone` by default;
 * `?thread=<ms>` when the conversation is read, 600 by default; `?auth=<ms>` when its sign-in is,
 * 900 by default; `?before=1` draws what the app drew before unknown was its own answer: the
 * composer from the first frame until the answer said someone else's). `window.__opening.frames`
 * holds one sample per frame from the load: what the footer showed and whether a field had the
 * focus.
 *
 * Fixtures only. Nothing here ships — `design-opening.html` is not `index.html`, and no route
 * imports this module.
 */
import {
  conversationFooter,
  type ConversationWriter,
  type RememberedWriter,
} from "@t3tools/client-runtime/zerops/conversationWriter";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ComposerRoomHeld,
  ComposerStandIn,
  ComposerStandInDock,
  type StandInTyped,
} from "~/components/chat/ComposerStandIn";
import {
  ConversationFooterStandIn,
  REMEMBERED_READ_ONLY,
} from "~/components/zerops/ConversationFooterStandIn";
import { ZeropsReadOnlyConversationFooter } from "~/components/zerops/ZeropsReadOnlyConversationFooter";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const ANSWERS: ReadonlyArray<RememberedWriter> = ["you", "someone", "nobody-yet"];
const asAnswer = (value: string | null): RememberedWriter | undefined =>
  ANSWERS.find((answer) => answer === value);
const REMEMBERED = asAnswer(params.get("remembered"));
const ANSWER = asAnswer(params.get("answer")) ?? "someone";
const THREAD_MS = Number(params.get("thread") ?? 600);
const AUTH_MS = Math.max(THREAD_MS, Number(params.get("auth") ?? 900));
const BEFORE = params.get("before") === "1";
const nothing = () => undefined;

type Phase = "opening" | "conversation" | "answered";

function useTyped() {
  const [typed, setTyped] = useState<StandInTyped>({ text: "", caret: 0 });
  return { typed, onType: setTyped };
}

/** The conversation's footer, as ChatView chooses it. */
function ConversationFooter({ writer }: { readonly writer: ConversationWriter }) {
  const { typed, onType } = useTyped();
  const footer = BEFORE
    ? writer.kind === "someone"
      ? "read-only"
      : "composer"
    : conversationFooter(writer, REMEMBERED);
  if (footer === "read-only") {
    return (
      <ComposerStandInDock>
        <ZeropsReadOnlyConversationFooter
          onSignIn={nothing}
          pendingApprovals={[]}
          pendingUserInputs={[]}
          readOnly={REMEMBERED_READ_ONLY}
        />
      </ComposerStandInDock>
    );
  }
  if (footer === "held") {
    return (
      <ComposerStandInDock held>
        <ComposerRoomHeld />
      </ComposerStandInDock>
    );
  }
  return <ComposerStandIn onType={onType} typed={typed} />;
}

function OpeningFooter() {
  const { typed, onType } = useTyped();
  const composer = <ComposerStandIn onType={onType} typed={typed} />;
  if (BEFORE) return composer;
  return (
    <ConversationFooterStandIn
      composer={composer}
      footer={conversationFooter({ kind: "unknown" }, REMEMBERED)}
    />
  );
}

function Harness() {
  const [phase, setPhase] = useState<Phase>("opening");
  useEffect(() => {
    const thread = setTimeout(() => setPhase("conversation"), THREAD_MS);
    const auth = setTimeout(() => setPhase("answered"), AUTH_MS);
    return () => {
      clearTimeout(thread);
      clearTimeout(auth);
    };
  }, []);
  return (
    <div className="flex h-svh flex-col bg-background text-foreground" data-phase={phase}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <p className="m-auto text-sm text-muted-foreground">
          {phase === "opening" ? "Opening Fen's conversation…" : "Fen's conversation"}
        </p>
        {phase === "opening" ? (
          <OpeningFooter key="opening" />
        ) : (
          <ConversationFooter
            key="conversation"
            writer={phase === "answered" ? { kind: ANSWER } : { kind: "unknown" }}
          />
        )}
      </div>
    </div>
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
