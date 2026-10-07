/**
 * The sign-in (`ZeropsAgentSignIn.logic.ts`), one module everywhere: in a Mate's arrival and its
 * empty conversation it stands in the stage's slot; wherever else a sign-in starts — the model
 * picker, the band, the Crew tab's lock, the project panel's coding agents — it sits in a small
 * dialog (`ZeropsAgentSignInDialog`), opened on the agent that was asked for.
 *
 * Two cards with the agents' own logos say whose account each needs, the project's usual one
 * first. The chosen card opens in place — from its own box (a clip reveal, 260 ms), the other card
 * fading (140 ms) — into two numbered steps, and its login starts that moment so the provider's
 * page is ready by the time it is asked for. *Open Claude* opens it in a new tab at once — a tab
 * opened before the page's address is printed is sent there when it is — and the code Claude
 * shows is pasted into the field, which sends it on paste. Codex shows its short code to type on
 * OpenAI's page and finishes by itself. What the login prints stays behind *Show what's
 * happening*, in the theme's own colours.
 */
import { useAtomValue } from "@effect/atom-react";
import { zeropsAgentAuthView } from "@t3tools/client-runtime/zerops/agentLogin";
import type {
  EnvironmentId,
  ScopedThreadRef,
  ZeropsAgentAuth,
  ZeropsAgentId,
  ZeropsAgentLoginState,
} from "@t3tools/contracts";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, RotateCcwIcon } from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import { ClaudeAI, OpenAI } from "~/components/Icons";
import { SurfaceLoading } from "../SurfaceLoading";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { useEnvironment } from "~/state/environments";
import { primaryServerKeybindingsAtom } from "~/state/server";
import { useAgentLogin } from "~/zerops/useAgentLogin";
import { useAgentLoginCancel } from "~/zerops/useAgentLoginCancel";
import { useAgentLoginSubmitCode } from "~/zerops/useAgentLoginSubmitCode";
import { useUsualAgent } from "~/zerops/useUsualAgent";
import { useZeropsEnvironmentProject } from "~/zerops/useZeropsEnvironmentProject";
import { useZeropsAgentAuth } from "~/zerops/useZeropsFeeds";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";

import { ArrivalSpinner } from "./ZeropsArrivalSteps";
import {
  abbreviatedCode,
  AGENT_SIGN_IN_CARDS,
  agentSignInSteps,
  agentSignInWords,
  currentAttempt,
  HIDE_WHATS_HAPPENING,
  loginRunning,
  openAgentOf,
  REPLACE_SIGN_IN_PRESS,
  replacedSignInLine,
  SHOW_WHATS_HAPPENING,
  signInAgents,
  startsAtOnce,
  signInFoot,
  USUAL_AGENT_TITLE,
  USUAL_AGENT_WORD,
  type AgentSignInSteps,
} from "./ZeropsAgentSignIn.logic";

const TerminalViewport = lazy(() =>
  import("~/components/ThreadTerminalDrawer").then((module) => ({
    default: module.TerminalViewport,
  })),
);

const EASE_OUT_STRONG = "cubic-bezier(0.23, 1, 0.32, 1)";

/** Where an opening card comes from: the chosen card's box, or — a switch, a retry — a fade. */
type CardOrigin = DOMRect | "fade" | null;
const COPIED_MS = 2_000;
/** How long a card's leaving takes: its fade, and a frame to spare. */
const CARDS_LEAVE_MS = 180;

/** An agent as a sign-in shows it: its row, and what a login beyond the defaults calls it. */
export type SignInAgent = Pick<ZeropsAgentAuth, "agentId" | "login"> &
  Partial<Omit<ZeropsAgentAuth, "agentId" | "login">>;

export interface AgentSignInViewProps {
  /** The agents offered, in the order offered (`signInAgents`). */
  readonly agents: ReadonlyArray<SignInAgent>;
  /** The project's usual agent, whose card says so. */
  readonly usual: ZeropsAgentId | null;
  /** The Mate being signed in; null where the sign-in is not one Mate's. */
  readonly mateName: string | null;
  /** Opened on one agent from the start, with no other to switch to (a dialog asked for it). */
  readonly fixed?: boolean;
  /** What the open card calls its agent: a login beyond the defaults' own name. */
  readonly title?: string | undefined;
  /** The Mate takes Claude's code in a field (`agentLoginCode`). */
  readonly codeField: boolean;
  readonly onStart: (agentId: ZeropsAgentId) => void;
  readonly onCancel: (agentId: ZeropsAgentId) => void;
  /** Resolves whether the Mate took the code. */
  readonly onSubmitCode: (agentId: ZeropsAgentId, code: string) => Promise<boolean>;
  /** The login's own terminal, for *Show what's happening*; null where there is none to show. */
  readonly terminal: (agentId: ZeropsAgentId, login: ZeropsAgentLoginState) => ReactNode;
  /** Drawn after its place was already on screen: it fades in rather than stand there. */
  readonly arrives?: boolean;
  /** Opens with what the login prints already shown. */
  readonly watching?: boolean;
  /** Who is signing in: a sign-in of their own is said as theirs. */
  readonly viewerSubject?: string | undefined;
  /** A member's name by their user id, for whose sign-in a login replaces. */
  readonly nameOf?: ((subject: string) => string | undefined) | undefined;
}

/** The cards, and the one that stands open. */
export function AgentSignInView(props: AgentSignInViewProps) {
  const { agents, fixed = false } = props;
  // The order the cards were first drawn in stays: a late answer never moves them.
  const [usual] = useState(props.usual);
  const [chosen, setChosen] = useState<ZeropsAgentId | null>(() =>
    fixed ? (agents[0]?.agentId ?? null) : null,
  );
  // When the open card's attempt began: a failure left from an earlier one is not its outcome.
  const [since, setSince] = useState<number | null>(() => (fixed ? Date.now() : null));
  const open = openAgentOf(agents, chosen);
  const origin = useRef<CardOrigin>(null);
  const [cardsLeaving, setCardsLeaving] = useState(false);

  const choose = (agentId: ZeropsAgentId, from: CardOrigin) => {
    origin.current = from;
    setChosen(agentId);
    setSince(Date.now());
    props.onStart(agentId);
  };

  // A dialog opened on an agent starts its login at once, unless the agent holds a sign-in: a login
  // started drops it, so the person presses first, told whose it replaces.
  const [waitsForPress] = useState(() => {
    const opened = agents.find((agent) => agent.agentId === chosen);
    return fixed && opened !== undefined && !startsAtOnce(opened);
  });
  const [pressed, setPressed] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!fixed || waitsForPress || started.current || chosen === null) return;
    started.current = true;
    props.onStart(chosen);
  }, [chosen, fixed, props, waitsForPress]);

  useEffect(() => {
    if (!cardsLeaving) return;
    const timer = window.setTimeout(() => setCardsLeaving(false), CARDS_LEAVE_MS);
    return () => window.clearTimeout(timer);
  }, [cardsLeaving]);

  const cards = (leaving: boolean) => (
    <div
      aria-hidden={leaving ? true : undefined}
      className="arrival-cards"
      data-leaving={leaving ? "" : undefined}
      inert={leaving}
    >
      {agents.map((agent) => (
        <AgentCard
          agentId={agent.agentId}
          key={agent.agentId}
          onChoose={(event) => {
            setCardsLeaving(true);
            choose(agent.agentId, event.currentTarget.getBoundingClientRect());
          }}
          usual={agent.agentId === usual}
        />
      ))}
    </div>
  );

  const openAgent = agents.find((agent) => agent.agentId === open);
  return (
    <div
      className="arrival-sign-in"
      data-arrives={props.arrives === true ? "" : undefined}
      data-open={open ?? undefined}
      data-zerops-surface="agent-sign-in"
    >
      {openAgent === undefined ? (
        cards(false)
      ) : (
        <>
          {cardsLeaving ? cards(true) : null}
          <OpenCard
            {...props}
            agent={openAgent}
            key={openAgent.agentId}
            origin={origin}
            since={since}
            replace={
              waitsForPress && !pressed
                ? replacedSignInLine({
                    agentId: openAgent.agentId,
                    authorizedBy: openAgent.authorizedBy,
                    viewerSubject: props.viewerSubject,
                    nameOf: props.nameOf ?? NO_NAMES,
                  })
                : null
            }
            onReplace={() => {
              setPressed(true);
              setSince(Date.now());
              props.onStart(openAgent.agentId);
            }}
            onRetry={() => choose(openAgent.agentId, "fade")}
            onSwitch={
              fixed || agents.length < 2
                ? null
                : () => {
                    const other = agents.find((agent) => agent.agentId !== openAgent.agentId);
                    if (other === undefined) return;
                    if (loginRunning(openAgent.login)) props.onCancel(openAgent.agentId);
                    choose(other.agentId, "fade");
                  }
            }
          />
        </>
      )}
    </div>
  );
}

function AgentLogoTile({ agentId, small = false }: { agentId: ZeropsAgentId; small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="arrival-logo"
      data-agent-logo={agentId}
      data-small={small ? "" : undefined}
    >
      {agentId === "claude-code" ? (
        <ClaudeAI className={small ? "size-4.5" : "size-5"} />
      ) : (
        <OpenAI className={small ? "size-4.5" : "size-5"} />
      )}
    </span>
  );
}

function AgentCard({
  agentId,
  usual,
  onChoose,
}: {
  readonly agentId: ZeropsAgentId;
  readonly usual: boolean;
  readonly onChoose: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const card = AGENT_SIGN_IN_CARDS[agentId];
  return (
    <button className="arrival-card" data-agent-id={agentId} onClick={onChoose} type="button">
      <AgentLogoTile agentId={agentId} />
      <span className="arrival-card-words">
        <span className="arrival-card-name">
          {card.name}
          {usual ? (
            <span className="arrival-chip" data-usual-agent>
              {USUAL_AGENT_WORD}
              <span className="sr-only"> — {USUAL_AGENT_TITLE}</span>
            </span>
          ) : null}
        </span>
        <span className="arrival-card-account">{card.account}</span>
      </span>
    </button>
  );
}

function OpenCard({
  agent,
  mateName,
  title,
  codeField,
  origin,
  since,
  replace,
  onReplace,
  onSwitch,
  onRetry,
  onSubmitCode,
  terminal,
  watching: watchingFirst = false,
}: AgentSignInViewProps & {
  readonly agent: SignInAgent;
  readonly origin: { current: CardOrigin };
  readonly since: number | null;
  /** What signing in replaces, while the login waits for the person's press; null once it does not. */
  readonly replace: string | null;
  readonly onReplace: () => void;
  readonly onSwitch: (() => void) | null;
  readonly onRetry: () => void;
}) {
  const agentId = agent.agentId;
  const attempt = currentAttempt(agent.login, since);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [sent, setSent] = useState<string | undefined>(undefined);
  const [sendFailed, setSendFailed] = useState(false);
  const [watching, setWatching] = useState(watchingFirst);
  // The attempt this card opened its page for: a new attempt opens it afresh.
  const opened = openedAt !== null && (since === null || openedAt >= since);
  const steps = agentSignInSteps({ agentId, login: attempt, opened, codeField, sent });
  const words = agentSignInWords(agentId, mateName);
  const card = AGENT_SIGN_IN_CARDS[agentId];
  const box = useRef<HTMLDivElement>(null);

  // A tab opened before the page's address was printed goes there the moment it is.
  const pending = useRef<Window | null>(null);
  const url = attempt?.url;
  useEffect(() => {
    if (url === undefined || pending.current === null) return;
    if (!pending.current.closed) pending.current.location.href = url;
    pending.current = null;
  }, [url]);
  useEffect(
    () => () => {
      // A tab still waiting for an address that will never come is closed with the card.
      if (pending.current !== null && !pending.current.closed) pending.current.close();
    },
    [],
  );

  // A code sent is checked until the login says how it went.
  const phase = attempt?.phase;
  useEffect(() => {
    if (phase === "failed" || phase === "succeeded" || phase === undefined) setSent(undefined);
  }, [phase]);

  // Opened from its card: the card's box grows into this one.
  useLayoutEffect(() => {
    const element = box.current;
    const from = origin.current;
    origin.current = null;
    if (element === null || from === null) return;
    const children = Array.from(element.children);
    const fadeIn = () => {
      for (const child of children) {
        child.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 200,
          delay: 60,
          easing: EASE_OUT_STRONG,
          fill: "backwards",
        });
      }
    };
    if (from === "fade" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fadeIn();
      return;
    }
    const to = element.getBoundingClientRect();
    const inset = [
      Math.max(0, from.top - to.top),
      Math.max(0, to.right - from.right),
      Math.max(0, to.bottom - from.bottom),
      Math.max(0, from.left - to.left),
    ];
    element.animate(
      [
        { clipPath: `inset(${inset.map((value) => `${value}px`).join(" ")} round 14px)` },
        { clipPath: "inset(0px 0px 0px 0px round 14px)" },
      ],
      { duration: 260, easing: EASE_OUT_STRONG },
    );
    fadeIn();
  }, [origin]);

  const openPage = (event: MouseEvent) => {
    setOpenedAt(Date.now());
    if (url !== undefined) return;
    // Its address is not printed yet: the tab opens now, on the person's press, and is sent there.
    event.preventDefault();
    const tab = window.open("about:blank", "_blank");
    if (tab !== null) {
      tab.opener = null;
      pending.current = tab;
    }
  };

  const submit = (code: string) => {
    const trimmed = code.trim();
    if (trimmed.length === 0 || sent !== undefined) return;
    setSent(trimmed);
    setSendFailed(false);
    void onSubmitCode(agentId, trimmed).then((accepted) => {
      if (accepted) return;
      setSent(undefined);
      setSendFailed(true);
    });
  };

  const showTerminal =
    attempt !== undefined &&
    (watching || (steps.kind === "steps" && steps.second.kind === "terminal"));
  return (
    <div
      className="arrival-open"
      data-agent-id={agentId}
      data-sign-in={
        steps.kind === "steps"
          ? steps.second.kind === "checking"
            ? "checking"
            : "steps"
          : steps.kind
      }
      ref={box}
    >
      <div className="arrival-open-head">
        <AgentLogoTile agentId={agentId} small />
        <span className="arrival-card-words">
          <span className="arrival-card-name">{title ?? card.name}</span>
          <span className="arrival-card-account">{card.account}</span>
        </span>
        <span className="flex-1" />
        {onSwitch === null ? null : (
          <button className="arrival-link" data-sign-in-switch onClick={onSwitch} type="button">
            {words.switchTo}
          </button>
        )}
      </div>
      <div aria-live="polite" className="arrival-open-body">
        {replace === null ? (
          <OpenCardSteps
            agentId={agentId}
            onOpenPage={openPage}
            onRetry={onRetry}
            onSubmit={submit}
            sendFailed={sendFailed}
            steps={steps}
            words={words}
          />
        ) : (
          <div className="arrival-open-step" data-sign-in-step="replace">
            <span />
            <span className="arrival-open-step-words">{replace}</span>
            <Button data-sign-in-replace onClick={onReplace} size="sm">
              {REPLACE_SIGN_IN_PRESS}
            </Button>
          </div>
        )}
      </div>
      <div className="arrival-terminal-fold" data-open={showTerminal ? "" : undefined}>
        <div className="arrival-terminal-inner">
          {attempt === undefined ? null : (
            <div className="arrival-terminal" data-arrival-terminal>
              {showTerminal ? terminal(agentId, attempt) : null}
            </div>
          )}
        </div>
      </div>
      <div className="arrival-open-foot">
        <span>{signInFoot(mateName)}</span>
        {attempt === undefined ||
        (steps.kind === "steps" && steps.second.kind === "terminal") ? null : (
          <button
            aria-expanded={watching}
            className="arrival-link"
            data-sign-in-watch
            onClick={() => setWatching((value) => !value)}
            type="button"
          >
            {watching ? HIDE_WHATS_HAPPENING : SHOW_WHATS_HAPPENING}
          </button>
        )}
      </div>
    </div>
  );
}

function OpenCardSteps({
  agentId,
  steps,
  words,
  sendFailed,
  onOpenPage,
  onSubmit,
  onRetry,
}: {
  readonly agentId: ZeropsAgentId;
  readonly steps: AgentSignInSteps;
  readonly words: ReturnType<typeof agentSignInWords>;
  readonly sendFailed: boolean;
  readonly onOpenPage: (event: MouseEvent) => void;
  readonly onSubmit: (code: string) => void;
  readonly onRetry: () => void;
}) {
  if (steps.kind === "signed-in") {
    return (
      <div className="arrival-open-step" data-sign-in-outcome="signed-in">
        <span className="arrival-num" data-done="">
          <CheckIcon aria-hidden="true" className="size-3" />
        </span>
        <span className="arrival-open-step-words">{words.signedIn}</span>
        <span />
      </div>
    );
  }
  if (steps.kind === "failed") {
    return (
      <div className="arrival-open-step" data-sign-in-outcome="failed">
        <span className="arrival-num" data-failed="">
          !
        </span>
        <span className="arrival-open-step-words" role="alert">
          {steps.why}
        </span>
        <Button onClick={onRetry} size="sm" variant="outline">
          <RotateCcwIcon aria-hidden="true" />
          {words.tryAgain}
        </Button>
      </div>
    );
  }
  const { page, second } = steps;
  const pageDone = page.state === "opened";
  return (
    <>
      <div className="arrival-open-step" data-sign-in-step="page">
        <span className="arrival-num" data-done={pageDone ? "" : undefined}>
          {pageDone ? <CheckIcon aria-hidden="true" className="size-3" /> : "1"}
        </span>
        <span className="arrival-open-step-words" data-quiet={pageDone ? "" : undefined}>
          {pageDone ? (page.url === undefined ? words.opening : words.opened) : words.open}
        </span>
        {pageDone ? (
          page.url === undefined ? (
            <span />
          ) : (
            <a className="arrival-link" href={page.url} rel="noopener noreferrer" target="_blank">
              {words.openAgain}
            </a>
          )
        ) : (
          <Button
            data-sign-in-open={agentId}
            onClick={onOpenPage}
            render={
              <a
                href={page.state === "ready" ? page.url : "about:blank"}
                rel="noopener noreferrer"
                target="_blank"
              />
            }
            size="sm"
          >
            {words.openPress}
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      {second.kind === "type" ? (
        <TypeCodeStep code={second.code} words={words} />
      ) : (
        <PasteCodeStep
          checking={second.kind === "checking" ? (second.code ?? "") : null}
          focus={pageDone}
          onSubmit={onSubmit}
          sendFailed={sendFailed}
          terminal={second.kind === "terminal"}
          words={words}
        />
      )}
    </>
  );
}

function PasteCodeStep({
  checking,
  terminal,
  focus,
  sendFailed,
  words,
  onSubmit,
}: {
  /** The code being checked, as sent; null while there is none. */
  readonly checking: string | null;
  readonly terminal: boolean;
  readonly focus: boolean;
  readonly sendFailed: boolean;
  readonly words: ReturnType<typeof agentSignInWords>;
  readonly onSubmit: (code: string) => void;
}) {
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus && checking === null) field.current?.focus();
  }, [checking, focus]);
  return (
    <div className="arrival-open-step" data-sign-in-step="code">
      <span className="arrival-num">2</span>
      <span className="arrival-open-step-words">{terminal ? words.terminal : words.paste}</span>
      <span />
      {terminal ? null : (
        <span className="arrival-open-step-field">
          {checking === null ? (
            <input
              aria-label={words.paste}
              autoComplete="one-time-code"
              className="arrival-input"
              data-sign-in-code
              onChange={(event) => setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onSubmit(value);
              }}
              onPaste={(event) => {
                const pasted = event.clipboardData.getData("text").trim();
                if (pasted.length === 0) return;
                event.preventDefault();
                setValue(pasted);
                onSubmit(pasted);
              }}
              placeholder={words.pastePlaceholder}
              ref={field}
              spellCheck={false}
              value={value}
            />
          ) : (
            <span className="arrival-field" data-sign-in-checking>
              <span className="arrival-field-value">{abbreviatedCode(checking)}</span>
              <span className="flex-1" />
              <ArrivalSpinner className="arrival-spin" />
              <span>{words.checking}</span>
            </span>
          )}
        </span>
      )}
      {terminal ? null : (
        <span className="arrival-open-step-hint" data-failed={sendFailed ? "" : undefined}>
          {sendFailed ? "The code didn't reach the sign-in. Paste it again." : words.pasteHint}
        </span>
      )}
    </div>
  );
}

function TypeCodeStep({
  code,
  words,
}: {
  readonly code: string | undefined;
  readonly words: ReturnType<typeof agentSignInWords>;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <div className="arrival-open-step" data-sign-in-step="code">
      <span className="arrival-num">2</span>
      <span className="arrival-open-step-words">{words.type}</span>
      <span />
      <span className="arrival-open-step-field flex items-center gap-2">
        <span className="arrival-code" data-sign-in-device-code>
          {code ?? <ArrivalSpinner className="arrival-spin" />}
        </span>
        {code === undefined ? null : (
          <Button
            onClick={() => {
              void navigator.clipboard.writeText(code).then(
                () => setCopied(true),
                () => undefined,
              );
            }}
            size="sm"
            variant="outline"
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? words.copied : words.copy}
          </Button>
        )}
      </span>
      <span className="arrival-open-step-hint">
        <ArrivalSpinner className="arrival-spin" />
        {words.typeHint}
      </span>
    </div>
  );
}

// ── Connected ────────────────────────────────────────────────────────────────────────────────

/** A login beyond the agents' own (crew mode's *Runs on*): its own id and name. */
export interface SignInLogin {
  readonly id: string;
  readonly agentId: ZeropsAgentId;
  readonly title: string;
  readonly login: ZeropsAgentLoginState | undefined;
}

/**
 * The sign-in of one Mate's agents, as its environment reads them: the login started, cancelled
 * and handed its code through the Mate (`useAgentLogin`), its terminal attached on request.
 */
export function ZeropsAgentSignIn({
  environmentId,
  threadRef,
  mateName,
  agentId = null,
  login = null,
}: {
  readonly environmentId: EnvironmentId | null;
  /** The conversation the login's terminal belongs to; nothing starts without one. */
  readonly threadRef: ScopedThreadRef | null;
  readonly mateName: string | null;
  /** Opened on this agent, with no other offered. */
  readonly agentId?: ZeropsAgentId | null;
  /** Opened on a login beyond the agents' own. */
  readonly login?: SignInLogin | null;
}) {
  const snapshot = zeropsAgentAuthView(useZeropsAgentAuth(environmentId)).snapshot;
  const project = useZeropsEnvironmentProject(environmentId);
  const usual = useUsualAgent(project?.projectId);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  // Whose sign-in a dialog's login replaces, by name: read only where it is somebody else's.
  const nameOf = useHqPersonNames(project?.orgId);
  const start = useAgentLogin(threadRef, { terminalSurface: "embedded" });
  const cancel = useAgentLoginCancel(threadRef);
  const submitCode = useAgentLoginSubmitCode(threadRef);
  const codeField =
    useEnvironment(environmentId)?.serverConfig?.environment?.capabilities.agentLoginCode === true;
  const loginId = login?.id;
  // It waited for the project's order: its cards arrive rather than stand there.
  const waited = useRef(!usual.settled);
  const onStart = useCallback((id: ZeropsAgentId) => start(id, loginId), [loginId, start]);
  const onCancel = useCallback((id: ZeropsAgentId) => cancel(id, loginId), [cancel, loginId]);
  const onSubmitCode = useCallback(
    (id: ZeropsAgentId, code: string) => submitCode(id, code, loginId),
    [loginId, submitCode],
  );
  const terminal = useCallback(
    (id: ZeropsAgentId, attempt: ZeropsAgentLoginState) =>
      threadRef === null ? null : (
        <SignInTerminal agentId={id} attempt={attempt} threadRef={threadRef} />
      ),
    [threadRef],
  );
  if (snapshot === null && login === null) return null;
  const agents: ReadonlyArray<SignInAgent> =
    login !== null
      ? [{ agentId: login.agentId, login: login.login }]
      : agentId !== null
        ? (snapshot?.agents ?? []).filter((agent) => agent.agentId === agentId)
        : signInAgents(snapshot?.agents ?? [], usual.usual);
  if (agents.length === 0) return null;
  // Offered in the project's own order: wait for it, briefly, rather than move a card later.
  if (!usual.settled && login === null && agentId === null) return null;
  return (
    <AgentSignInView
      arrives={waited.current}
      agents={agents}
      codeField={codeField}
      fixed={login !== null || agentId !== null}
      mateName={mateName}
      nameOf={nameOf}
      onCancel={onCancel}
      onStart={onStart}
      onSubmitCode={onSubmitCode}
      terminal={terminal}
      title={login?.title}
      usual={usual.usual}
      viewerSubject={viewerSubject}
    />
  );
}

/** What the login prints, in the theme's own colours. */
function SignInTerminal({
  agentId,
  attempt,
  threadRef,
}: {
  readonly agentId: ZeropsAgentId;
  readonly attempt: ZeropsAgentLoginState;
  readonly threadRef: ScopedThreadRef;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  return (
    <Suspense
      fallback={
        <div className="h-32">
          <SurfaceLoading />
        </div>
      }
    >
      <TerminalViewport
        advancedTypography={false}
        autoFocus={false}
        cwd="/var/www"
        drawerHeight={128}
        focusRequestId={0}
        key={attempt.terminalId}
        keybindings={keybindings}
        onAddTerminalContext={NOOP}
        onSessionExited={NOOP}
        resizeEpoch={0}
        terminalId={attempt.terminalId}
        terminalLabel={`${AGENT_SIGN_IN_CARDS[agentId].name} sign-in`}
        threadId={threadRef.threadId}
        threadRef={threadRef}
        visible
      />
    </Suspense>
  );
}

const NOOP = () => {};
/** No member's name known. */
const NO_NAMES = (_subject: string): string | undefined => undefined;

/** How long a dialog shows a sign-in done before it closes itself. */
const SIGNED_IN_CLOSE_MS = 900;

/**
 * The sign-in where it is started outside the Mate's own view: the same module in a small dialog,
 * opened on the agent that was asked for, which closes itself a moment after the sign-in is done.
 */
export function ZeropsAgentSignInDialog({
  environmentId,
  threadRef,
  mateName,
  agentId,
  login = null,
  onClose,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly threadRef: ScopedThreadRef | null;
  readonly mateName: string | null;
  readonly agentId: ZeropsAgentId | null;
  readonly login?: SignInLogin | null;
  readonly onClose: () => void;
}) {
  const snapshot = zeropsAgentAuthView(useZeropsAgentAuth(environmentId)).snapshot;
  const shown = login?.agentId ?? agentId;
  const attempt =
    login !== null
      ? login.login
      : snapshot?.agents.find((agent) => agent.agentId === agentId)?.login;
  const [openedAt] = useState(() => Date.now());
  const signedIn = currentAttempt(attempt, openedAt)?.phase === "succeeded";
  useEffect(() => {
    if (!signedIn) return;
    const timer = window.setTimeout(onClose, SIGNED_IN_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [onClose, signedIn]);
  if (shown === null) return null;
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <ZeropsAgentSignInDialogPopup mateName={mateName} title={login?.title}>
        <ZeropsAgentSignIn
          agentId={login === null ? agentId : null}
          environmentId={environmentId}
          login={login}
          mateName={mateName}
          threadRef={threadRef}
        />
      </ZeropsAgentSignInDialogPopup>
    </Dialog>
  );
}

/** The small dialog's frame: its title and one sentence over the sign-in. */
export function ZeropsAgentSignInDialogPopup({
  mateName,
  title,
  children,
}: {
  readonly mateName: string | null;
  readonly title?: string | undefined;
  readonly children: ReactNode;
}) {
  return (
    <DialogPopup bottomStickOnMobile={false} className="max-w-xl">
      <DialogHeader>
        <DialogTitle>
          {title !== undefined
            ? `Sign in ${title}`
            : mateName === null
              ? "Sign in a coding agent"
              : `Sign ${mateName} in`}
        </DialogTitle>
      </DialogHeader>
      <DialogPanel>{children}</DialogPanel>
    </DialogPopup>
  );
}
