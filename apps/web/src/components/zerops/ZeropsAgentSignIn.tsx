/**
 * The sign-in (`ZeropsAgentSignIn.logic.ts`), one module everywhere: in a Mate's arrival and its
 * empty conversation it stands in the stage's slot; wherever else a sign-in starts — the model
 * picker, the band, the Crew tab's lock, the project panel's coding agents — it sits in a small
 * dialog (`ZeropsAgentSignInDialog`), opened on the agent that was asked for.
 *
 * A card per agent, with its own logo, says whose account it needs, the project's usual one
 * first, every one shown: two to a line where the slot has room, else one under another. The
 * chosen card's numbered steps open in a dialog over the list, which stays as it was; one is open
 * at a time, and its login starts that moment so the provider's page is ready by the time it is
 * asked for. *Open
 * Claude* opens it in a new tab at once — a tab opened before the page's address is printed is
 * sent there when it is — and the code the page shows is pasted into the field, which sends it on
 * paste (Claude Code, Antigravity). Codex and Grok show their short code to confirm on the
 * provider's page; Cursor waits for the approval there; all three finish by themselves. Closing the
 * dialog stops the login it started. What the login prints stays behind *Show what's
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
  ZeropsUserId,
} from "@t3tools/contracts";
import { ArrowRightIcon, ArrowUpRightIcon, RotateCcwIcon } from "lucide-react";
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
  type RefObject,
} from "react";

import { mateLoginAsAgentRow } from "@t3tools/client-runtime/zerops/logins";
import { openCodeOffered } from "@t3tools/shared/openCodeKeyProviders";

import { OpenCodeIcon } from "~/components/Icons";
import { OpenCodeProviderKeys } from "../settings/OpenCodeProviderKeys";
import { usePlatformCapabilities } from "../../zerops/usePlatformCapabilities";
import { ZeropsAgentLogo } from "./ZeropsAgentLogo";
import { prefersReducedMotion } from "~/lib/reducedMotion";
import { Loading } from "../ui/loading";
import { LogoTile } from "../ui/logo-tile";
import { Spinner } from "../ui/spinner";
import { StepNumber } from "../ui/step-number";
import { Button, InlineButton } from "~/components/ui/button";
import { Text } from "~/components/ui/text";
import { cn } from "~/lib/utils";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { CodeFrame } from "~/components/ui/code-block";
import { CopyLine } from "~/components/ui/copy-line";
import { Row } from "~/components/ui/row";
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
import { appChunk } from "~/lib/appChunks";

import {
  abbreviatedCode,
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
  type AgentSignInSteps,
} from "./ZeropsAgentSignIn.logic";
import { AGENT_SIGN_IN_CARDS } from "@t3tools/client-runtime/zerops/agentSignIn";
import { Separator } from "~/components/ui/separator";

const TerminalViewport = lazy(
  appChunk(() =>
    import("~/components/ThreadTerminalDrawer").then((module) => ({
      default: module.TerminalViewport,
    })),
  ),
);

const EASE_OUT_STRONG = "cubic-bezier(0.23, 1, 0.32, 1)";

/** An agent as a sign-in shows it: its row, and what a login beyond the defaults calls it. */
export type SignInAgent = Pick<ZeropsAgentAuth, "agentId" | "login"> &
  Partial<Omit<ZeropsAgentAuth, "agentId" | "login">>;

interface AgentSignInViewProps {
  /** The agents offered, in the order offered (`signInAgents`): the project's usual one first. */
  readonly agents: ReadonlyArray<SignInAgent>;
  /** The Mate being signed in; null where the sign-in is not one Mate's. */
  readonly mateName: string | null;
  /** Opened on one agent from the start, with no other to switch to (a dialog asked for it). */
  readonly fixed?: boolean;
  /** What the open card calls its agent: a login beyond the defaults' own name. */
  readonly title?: string | undefined;
  /** The Mate takes a pasted code in a field (`agentLoginCode`). */
  readonly codeField: boolean;
  /** Retained login instructions are inert while their Mate is disconnected. */
  readonly available?: boolean;
  readonly onStart: (agentId: ZeropsAgentId) => void;
  /** Leave the replacement confirmation without starting a login. */
  readonly onDismiss?: (() => void) | undefined;
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
  readonly viewerSubject?: ZeropsUserId | undefined;
  /** A member's name by their user id, for whose sign-in a login replaces. */
  readonly nameOf?: ((subject: string) => string | undefined) | undefined;
  /**
   * OpenCode's free models and model keys (`OpenCodeProviderKeys`), where the Mate has OpenCode:
   * its card, after the agents', opens them in place. Its free models chosen or a key it runs on
   * sign the Mate in (`admissionNeedsSignIn`).
   */
  readonly openCode?: ReactNode | undefined;
}

/** OpenCode's card: it runs on its free models or a model provider's API key, never an account. */
const OPENCODE_CARD = {
  name: "OpenCode",
  account: "Free models or a model key",
  connect: "Connect OpenCode",
} as const;

const OPENCODE = "opencode" as const;

/** The cards, one under another, and the one that stands open among them. */
export function AgentSignInView(props: AgentSignInViewProps) {
  const { agents, fixed = false } = props;
  const [chosen, setChosen] = useState<ZeropsAgentId | null>(() =>
    fixed ? (agents[0]?.agentId ?? null) : null,
  );
  // When the open card's attempt began: a failure left from an earlier one is not its outcome.
  const [since, setSince] = useState<number | null>(() => (fixed ? Date.now() : null));
  const open = openAgentOf(agents, chosen);
  const openAgent = agents.find((agent) => agent.agentId === open);
  const [keysOpen, setKeysOpen] = useState(false);

  // Folds the open card: a login it started stops, so another can start.
  const fold = () => {
    if (openAgent !== undefined && loginRunning(openAgent.login)) props.onCancel(openAgent.agentId);
    setChosen(null);
    setSince(null);
    setKeysOpen(false);
  };
  const choose = (agentId: ZeropsAgentId) => {
    if (openAgent !== undefined && openAgent.agentId !== agentId && loginRunning(openAgent.login))
      props.onCancel(openAgent.agentId);
    setKeysOpen(false);
    setChosen(agentId);
    setSince(Date.now());
    if (props.available !== false) props.onStart(agentId);
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
    if (!fixed || waitsForPress || started.current || chosen === null || props.available === false)
      return;
    started.current = true;
    props.onStart(chosen);
  }, [chosen, fixed, props, waitsForPress]);

  const options: ReadonlyArray<ZeropsAgentId | typeof OPENCODE> = [
    ...agents.map((agent) => agent.agentId),
    ...(props.openCode === undefined ? [] : [OPENCODE]),
  ];
  const opened = keysOpen && props.openCode !== undefined ? OPENCODE : open;
  // The chosen option's steps: in the list where it is the only one (a dialog opened on it), else
  // in a dialog of their own.
  function renderOpen(option: ZeropsAgentId | typeof OPENCODE) {
    if (option === OPENCODE)
      return (
        <div className={OPEN_CLASS} data-agent-id={OPENCODE}>
          <div className={OPEN_HEAD_CLASS}>
            <OpenCodeLogoTile />
            <span className={OPEN_TITLE_CLASS}>{OPENCODE_CARD.connect}</span>
          </div>
          <Separator />
          <div className={OPEN_BODY_CLASS}>{props.openCode}</div>
        </div>
      );
    if (openAgent === undefined || option !== openAgent.agentId) return null;
    return (
      <OpenCard
        {...props}
        agent={openAgent}
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
        onDismiss={props.onDismiss ?? fold}
        onReplace={() => {
          setPressed(true);
          setSince(Date.now());
          props.onStart(openAgent.agentId);
        }}
        onRetry={() => choose(openAgent.agentId)}
      />
    );
  }
  function renderCard(option: ZeropsAgentId | typeof OPENCODE) {
    if (option !== OPENCODE)
      return (
        <AgentCard
          agentId={option}
          disabled={props.available === false}
          key={option}
          onChoose={() => choose(option)}
        />
      );
    return (
      <div className={CARD_CLASS} data-agent-id={OPENCODE} key={OPENCODE}>
        <Row
          aria-disabled={props.available === false || undefined}
          lead={<OpenCodeLogoTile />}
          line={OPENCODE_CARD.account}
          meta={<ArrowRightIcon aria-hidden="true" className="size-4" />}
          onClick={() => {
            fold();
            setKeysOpen(true);
          }}
          pressable
          render={<button disabled={props.available === false} type="button" />}
          size="lg"
          title={OPENCODE_CARD.name}
        />
      </div>
    );
  }

  return (
    <div
      // A card of its own in the stage's slot: its words start on their line, never the stage's
      // centred text (the owner, 2026-10-13: "once again misaligned").
      className="@container relative mx-auto flex w-full max-w-178 flex-col items-center text-start data-arrives:animate-zerops-appear"
      inert={props.available === false}
      aria-disabled={props.available === false || undefined}
      data-arrives={props.arrives === true ? "" : undefined}
      data-open={opened ?? undefined}
      data-zerops-surface="agent-sign-in"
    >
      {fixed ? (
        <div className="flex w-full flex-col">{opened === null ? null : renderOpen(opened)}</div>
      ) : (
        <>
          {/* Two to a line where the slot has room for two cards of their one-column width. */}
          <div className="grid w-full gap-2 @[40rem]:grid-cols-2">{options.map(renderCard)}</div>
          {/* Choosing one opens its steps over the list, which never moves; closing the dialog
              stops the login it started. */}
          <Dialog
            onOpenChange={(next) => {
              if (!next) fold();
            }}
            open={opened !== null}
          >
            <ZeropsAgentSignInDialogPopup mateName={props.mateName} title={props.title}>
              {opened === null ? null : renderOpen(opened)}
            </ZeropsAgentSignInDialogPopup>
          </Dialog>
        </>
      )}
    </div>
  );
}

/**
 * The sign-in's cards, to the owner's design (2026-11-23): on the raised ground, ringed. A card
 * lifts under the pointer and gives under a press.
 */
const CARD_GROUND_CLASS = "rounded-card bg-surface-raised ring-1 ring-border";
const CARD_CLASS = `${CARD_GROUND_CLASS} transition-[box-shadow,scale] duration-150 ease-out-strong hover:shadow-(--zerops-shadow-card) hover:ring-foreground/16 active:scale-[0.985] motion-reduce:transition-none`;

/** An open card: its logo and title over a rule, its steps, its foot. */
const OPEN_CLASS = `${CARD_GROUND_CLASS} overflow-hidden`;
const OPEN_HEAD_CLASS = "flex items-center gap-3 py-2.5 ps-2.5 pe-3";
const OPEN_TITLE_CLASS = "min-w-0 flex-1 text-emphasis leading-5 font-semibold text-foreground";
const OPEN_BODY_CLASS = "flex flex-col gap-3.5 px-4 pt-4 pb-4.5";

/**
 * A step: its number, its words, and under the words what it asks for (a press, a field). The
 * press stands under the words (`STEP_PRESS_CLASS`); "Open again" takes the account line's size.
 */
const STEP_CLASS = "grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-body";
const STEP_PRESS_CLASS = "col-start-2 justify-self-start";
const STEP_WORDS_CLASS = "text-body text-foreground";
const STEP_FIELD_CLASS = "col-[2/-1]";
const STEP_HINT_CLASS = "col-[2/-1] flex items-center gap-1.5 text-caption text-muted-foreground";

function AgentLogoTile({ agentId }: { agentId: ZeropsAgentId }) {
  return (
    <LogoTile data-agent-logo={agentId} size="lg">
      <ZeropsAgentLogo agentId={agentId} />
    </LogoTile>
  );
}

function OpenCodeLogoTile() {
  return (
    <LogoTile data-agent-logo="opencode" size="lg">
      <OpenCodeIcon />
    </LogoTile>
  );
}

function AgentCard({
  agentId,
  onChoose,
  disabled,
}: {
  readonly disabled: boolean;
  readonly agentId: ZeropsAgentId;
  readonly onChoose: () => void;
}) {
  const card = AGENT_SIGN_IN_CARDS[agentId];
  return (
    <div className={CARD_CLASS} data-agent-id={agentId}>
      <Row
        aria-disabled={disabled || undefined}
        lead={<AgentLogoTile agentId={agentId} />}
        line={card.account}
        meta={<ArrowRightIcon aria-hidden="true" className="size-4" />}
        onClick={onChoose}
        pressable
        render={<button disabled={disabled} type="button" />}
        size="lg"
        title={card.name}
      />
    </div>
  );
}

function OpenCard({
  agent,
  mateName,
  title,
  codeField,
  available = true,
  since,
  replace,
  onReplace,
  onDismiss,
  onRetry,
  onSubmitCode,
  terminal,
  watching: watchingFirst = false,
}: AgentSignInViewProps & {
  readonly agent: SignInAgent;
  readonly since: number | null;
  /** What signing in replaces, while the login waits for the person's press; null once it does not. */
  readonly replace: string | null;
  readonly onReplace: () => void;
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
  const body = useRef<HTMLDivElement>(null);
  useStepGlide(
    body,
    replace !== null
      ? "replace"
      : steps.kind === "steps"
        ? `${steps.second.kind}${sendFailed ? ":unsent" : ""}`
        : steps.kind,
  );

  // Once its address is printed the page opens by itself, while the press that opened this card
  // still lets the browser open a tab (its user activation, a few seconds); past that the press
  // waits in the card. Tried once per address, so a page the person closed is not opened again.
  const readyUrl = steps.kind === "steps" && steps.page.state === "ready" ? steps.page.url : null;
  const triedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (readyUrl === null || !available || triedUrl.current === readyUrl) return;
    triedUrl.current = readyUrl;
    if (navigator.userActivation?.isActive !== true) return;
    const tab = window.open("", "_blank");
    if (tab === null) return;
    tab.opener = null;
    tab.location.href = readyUrl;
    setOpenedAt(Date.now());
  }, [readyUrl, available]);

  // A code sent is checked until the login says how it went.
  const phase = attempt?.phase;
  useEffect(() => {
    if (phase === "failed" || phase === "succeeded" || phase === undefined) setSent(undefined);
  }, [phase]);

  const openPage = (event: MouseEvent) => {
    if (!available) {
      event.preventDefault();
      return;
    }
    setOpenedAt(Date.now());
  };

  const submit = (code: string) => {
    const trimmed = code.trim();
    if (!available || trimmed.length === 0 || sent !== undefined) return;
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
      className={OPEN_CLASS}
      data-agent-id={agentId}
      data-sign-in={
        steps.kind === "steps"
          ? steps.second.kind === "checking"
            ? "checking"
            : "steps"
          : steps.kind
      }
    >
      <div className={OPEN_HEAD_CLASS}>
        <AgentLogoTile agentId={agentId} />
        <span className={OPEN_TITLE_CLASS}>{title ?? words.connect}</span>
      </div>
      <Separator />
      <div aria-live="polite" className={OPEN_BODY_CLASS} ref={body}>
        {replace === null ? (
          <OpenCardSteps
            disabled={!available}
            agentId={agentId}
            onOpenPage={openPage}
            onRetry={onRetry}
            onSubmit={submit}
            sendFailed={sendFailed}
            steps={steps}
            words={words}
          />
        ) : (
          <div className={STEP_CLASS} data-sign-in-step="replace">
            <span />
            <span className={STEP_WORDS_CLASS}>{replace}</span>
            <div className={cn(STEP_PRESS_CLASS, "flex gap-2")}>
              <Button
                data-sign-in-replace-cancel
                autoFocus
                variant="secondary"
                onClick={onDismiss}
                size="sm"
              >
                Cancel
              </Button>
              <Button data-sign-in-replace onClick={onReplace} size="sm">
                {REPLACE_SIGN_IN_PRESS}
              </Button>
            </div>
          </div>
        )}
      </div>
      {/* What the login prints, behind *Show what's happening*: unfolding under the steps in
          260 ms, 128 px tall, in the theme's own colours (the terminal reads them here). */}
      <div
        className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-260 ease-out-strong data-open:grid-rows-[1fr] motion-reduce:transition-none"
        data-open={showTerminal ? "" : undefined}
      >
        <div className="min-h-0 overflow-hidden">
          {attempt === undefined ? null : (
            <CodeFrame className="mx-3.5 mb-3.5 h-32" data-arrival-terminal>
              <div className="size-full [--terminal-background:var(--color-code)] [--terminal-cursor:var(--color-code-foreground)] [--terminal-foreground:var(--color-code-foreground)] [--terminal-selection-background:color-mix(in_oklab,var(--color-code-foreground)_20%,transparent)]">
                {showTerminal ? terminal(agentId, attempt) : null}
              </div>
            </CodeFrame>
          )}
        </div>
      </div>
      {/* The open card's foot over a rule: whose account it runs on, and *Show what's happening*. */}
      <Separator />
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-body leading-4.5 text-muted-foreground">
        <span>{signInFoot(mateName)}</span>
        {attempt === undefined ||
        (steps.kind === "steps" && steps.second.kind === "terminal") ? null : (
          <InlineButton
            tone="muted"
            aria-expanded={watching}
            data-sign-in-watch
            onClick={() => setWatching((value) => !value)}
          >
            {watching ? HIDE_WHATS_HAPPENING : SHOW_WHATS_HAPPENING}
          </InlineButton>
        )}
      </div>
    </div>
  );
}

/** How long the open card's body takes to reach a step's height: as the cards' swap and the fold. */
const STEP_GLIDE_MS = 240;

/**
 * The open card's body glides to each step's height instead of jumping, so a dialog, centred,
 * re-centres smoothly and the arrival's slot grows with it. A glide still running is taken up
 * where it stands; what grows is clipped only while it glides.
 */
function useStepGlide(
  body: RefObject<HTMLDivElement | null>,
  step: string,
  duration: number = STEP_GLIDE_MS,
) {
  const settled = useRef<number | null>(null);
  const shown = useRef(step);
  useLayoutEffect(() => {
    const node = body.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (node.getAnimations().length === 0) settled.current = node.getBoundingClientRect().height;
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [body]);
  useLayoutEffect(() => {
    const node = body.current;
    const before = shown.current;
    shown.current = step;
    if (node === null || before === step) return;
    const running = node.getAnimations();
    const from = running.length > 0 ? node.getBoundingClientRect().height : settled.current;
    for (const glide of running) glide.cancel();
    const to = node.getBoundingClientRect().height;
    settled.current = to;
    if (from === null || Math.abs(from - to) < 1 || prefersReducedMotion()) return;
    node.animate(
      [
        { height: `${from}px`, overflow: "clip" },
        { height: `${to}px`, overflow: "clip" },
      ],
      { duration, easing: EASE_OUT_STRONG },
    );
  }, [body, duration, step]);
}

function OpenCardSteps({
  disabled,
  agentId,
  steps,
  words,
  sendFailed,
  onOpenPage,
  onSubmit,
  onRetry,
}: {
  readonly disabled: boolean;
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
      <div className={STEP_CLASS} data-sign-in-outcome="signed-in">
        <StepNumber n={1} state="done" />
        <span className={STEP_WORDS_CLASS}>{words.signedIn}</span>
      </div>
    );
  }
  if (steps.kind === "failed") {
    return (
      <div className={STEP_CLASS} data-sign-in-outcome="failed">
        <StepNumber n={1} state="failed" />
        <span className={STEP_WORDS_CLASS} role="alert">
          {steps.why}
        </span>
        <Button
          className={STEP_PRESS_CLASS}
          disabled={disabled}
          onClick={onRetry}
          size="sm"
          variant="secondary"
        >
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
      <div className={STEP_CLASS} data-sign-in-step="page">
        <StepNumber n={1} state={pageDone ? "done" : "todo"} />
        <span className={pageDone ? "text-body text-muted-foreground" : STEP_WORDS_CLASS}>
          {pageDone ? words.opened : words.open}
        </span>
        {pageDone ? (
          <InlineButton
            className={STEP_PRESS_CLASS}
            render={<a href={page.url} rel="noopener noreferrer" target="_blank" />}
            tone="muted"
          >
            {words.openAgain}
          </InlineButton>
        ) : page.state === "preparing" ? (
          // Its address is not printed yet: what is happening stands where the press will, at the
          // press's height, and the press takes its place once the address is there.
          <Text
            className={cn(STEP_PRESS_CLASS, "flex h-7 items-center gap-2")}
            data-sign-in-open={agentId}
            role="status"
            variant="remark"
          >
            <Spinner aria-hidden="true" size="sm" tone="muted" />
            {words.preparing}
          </Text>
        ) : (
          <Button
            className={STEP_PRESS_CLASS}
            disabled={disabled}
            data-sign-in-open={agentId}
            onClick={onOpenPage}
            render={<a href={page.url} rel="noopener noreferrer" target="_blank" />}
            size="sm"
          >
            {words.openPress}
            <ArrowUpRightIcon aria-hidden="true" />
          </Button>
        )}
      </div>
      {second.kind === "type" ? (
        <TypeCodeStep code={second.code} words={words} />
      ) : second.kind === "approve" ? (
        <ApproveStep waiting={page.state === "opened"} words={words} />
      ) : (
        <PasteCodeStep
          disabled={disabled}
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
  disabled,
  checking,
  terminal,
  focus,
  sendFailed,
  words,
  onSubmit,
}: {
  readonly disabled: boolean;
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
    if (!disabled && focus && checking === null) field.current?.focus();
  }, [checking, disabled, focus]);
  return (
    <div className={STEP_CLASS} data-sign-in-step="code">
      <StepNumber n={2} />
      <span className={STEP_WORDS_CLASS}>{terminal ? words.terminal : words.paste}</span>
      {terminal ? null : (
        <span className={STEP_FIELD_CLASS}>
          {checking === null ? (
            <Input
              disabled={disabled}
              aria-label={words.paste}
              autoComplete="one-time-code"
              data-sign-in-code
              nativeInput
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
              size="xl"
              spellCheck={false}
              value={value}
            />
          ) : (
            // Claude's code while it is checked: the field itself, read only, the code's ends in
            // mono, and the check at its end; the field's own height, so nothing under it moves.
            <InputGroup data-sign-in-checking>
              <InputGroupInput
                aria-label={words.paste}
                font="mono"
                readOnly
                size="xl"
                value={abbreviatedCode(checking)}
              />
              <InputGroupAddon align="inline-end">
                <Spinner aria-hidden="true" size="sm" tone="muted" />
                <Text variant="description">{words.checking}</Text>
              </InputGroupAddon>
            </InputGroup>
          )}
        </span>
      )}
      {terminal ? null : sendFailed ? (
        <span className={cn(STEP_HINT_CLASS, "text-status-failed-text")}>
          The code didn't reach the sign-in. Paste it again.
        </span>
      ) : (
        // What happens then, as the third step.
        <span className="col-[1/-1] mt-1 grid grid-cols-[24px_minmax(0,1fr)] items-center gap-x-3">
          <StepNumber n={3} />
          <span className={STEP_WORDS_CLASS}>{words.pasteHint}</span>
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
  return (
    <div className={STEP_CLASS} data-sign-in-step="code">
      <StepNumber n={2} />
      <span className={STEP_WORDS_CLASS}>{words.type}</span>
      {/* Codex's code, to type on OpenAI's page; Copy at its end. */}
      <CopyLine
        className={STEP_FIELD_CLASS}
        data-sign-in-device-code
        label="the code"
        size="lg"
        value={code ?? null}
      />
      <span className={STEP_HINT_CLASS}>
        <Spinner aria-hidden="true" size="sm" tone="muted" />
        {words.typeHint}
      </span>
    </div>
  );
}

/**
 * An approval the agent waits for (Cursor): nothing to type, only the page to finish on. The
 * waiting shows once the page is open; before that the step only says what comes.
 */
function ApproveStep({
  waiting,
  words,
}: {
  readonly waiting: boolean;
  readonly words: ReturnType<typeof agentSignInWords>;
}) {
  return (
    <div className={STEP_CLASS} data-sign-in-step="approve">
      <StepNumber n={2} />
      <span className={STEP_WORDS_CLASS}>{words.approve}</span>
      <span className={STEP_HINT_CLASS}>
        {waiting ? <Spinner aria-hidden="true" size="sm" tone="muted" /> : null}
        {words.approveHint}
      </span>
    </div>
  );
}

// ── Connected ────────────────────────────────────────────────────────────────────────────────

/** A login beyond the agents' own (crew mode's *Runs on*): its own id and name. */
interface SignInLogin {
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
  onDismiss,
}: {
  readonly environmentId: EnvironmentId | null;
  /** The conversation the login's terminal belongs to; nothing starts without one. */
  readonly threadRef: ScopedThreadRef | null;
  readonly mateName: string | null;
  /** Opened on this agent, with no other offered. */
  readonly agentId?: ZeropsAgentId | null;
  /** Opened on a login beyond the agents' own. */
  readonly login?: SignInLogin | null;
  readonly onDismiss?: (() => void) | undefined;
}) {
  const auth = useZeropsAgentAuth(environmentId);
  const snapshot = zeropsAgentAuthView(auth).snapshot;
  const project = useZeropsEnvironmentProject(environmentId);
  const usual = useUsualAgent(project?.projectId);
  const viewerSubject = useZeropsSessionOptional()?.user?.id;
  // Whose sign-in a dialog's login replaces, by name: read only where it is somebody else's.
  const nameOf = useHqPersonNames(project?.orgId);
  const start = useAgentLogin(threadRef, { terminalSurface: "embedded" });
  const cancel = useAgentLoginCancel(threadRef);
  const submitCode = useAgentLoginSubmitCode(threadRef);
  const environment = useEnvironment(environmentId);
  const available =
    environment?.connection.phase === "connected" &&
    auth?.state === "known" &&
    auth.freshness.kind === "live";
  const codeField = environment?.serverConfig?.environment?.capabilities.agentLoginCode === true;
  const capabilities = usePlatformCapabilities(environmentId);
  // Offered until the role is known to forbid it, as every project control is; the server decides.
  const keysReadOnly = capabilities.projectAccessKnown && !capabilities.operate;
  // Offered at once, not after OpenCode's first check (`openCodeOffered`).
  const hasOpenCode = openCodeOffered(environment?.serverConfig?.providers);
  const loginId = login?.id;
  // It waited for the project's order: its cards arrive rather than stand there.
  const waited = useRef(!usual.settled);
  const onStart = useCallback(
    (id: ZeropsAgentId) => {
      if (available) start(id, loginId);
    },
    [available, loginId, start],
  );
  const onCancel = useCallback((id: ZeropsAgentId) => cancel(id, loginId), [cancel, loginId]);
  const onSubmitCode = useCallback(
    (id: ZeropsAgentId, code: string) =>
      available ? submitCode(id, code, loginId) : Promise.resolve(false),
    [available, loginId, submitCode],
  );
  const terminal = useCallback(
    (id: ZeropsAgentId, attempt: ZeropsAgentLoginState) =>
      threadRef === null ? null : (
        <SignInTerminal agentId={id} attempt={attempt} threadRef={threadRef} />
      ),
    [threadRef],
  );
  if (snapshot === null && login === null) return null;
  const loginRow = snapshot?.logins?.find((row) => row.id === login?.id);
  const agents: ReadonlyArray<SignInAgent> =
    login !== null
      ? loginRow === undefined
        ? []
        : [mateLoginAsAgentRow(loginRow)]
      : agentId !== null
        ? (snapshot?.agents ?? []).filter((agent) => agent.agentId === agentId)
        : signInAgents(snapshot?.agents ?? [], usual.usual);
  if (agents.length === 0) return null;
  // Offered in the project's own order: wait for it, briefly, rather than move a card later.
  if (!usual.settled && login === null && agentId === null) return null;
  return (
    <AgentSignInView
      available={available}
      arrives={waited.current}
      agents={agents}
      codeField={codeField}
      fixed={login !== null || agentId !== null}
      mateName={mateName}
      nameOf={nameOf}
      onCancel={onCancel}
      onStart={onStart}
      onDismiss={onDismiss}
      onSubmitCode={onSubmitCode}
      terminal={terminal}
      title={login?.title}
      viewerSubject={viewerSubject}
      openCode={
        // Among every agent offered, never a dialog opened on one.
        environmentId === null || !hasOpenCode || login !== null || agentId !== null ? undefined : (
          <OpenCodeProviderKeys environmentId={environmentId} readOnly={keysReadOnly} />
        )
      }
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
          <Loading label="The sign-in" shape="room" />
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
        touchScrollback={false}
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
          onDismiss={onClose}
          mateName={mateName}
          threadRef={threadRef}
        />
      </ZeropsAgentSignInDialogPopup>
    </Dialog>
  );
}

/**
 * The small dialog's frame: its title and one sentence over the sign-in. Centred in the window, it
 * stays centred as a step, a code or what's happening opens and closes in it.
 */
export function ZeropsAgentSignInDialogPopup({
  mateName,
  title,
  children,
}: {
  readonly mateName: string | null;
  readonly title?: string | undefined;
  readonly children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <DialogPopup
      ref={popup}
      bottomStickOnMobile={false}
      className="max-w-xl"
      placement="center"
      initialFocus={() =>
        popup.current?.querySelector<HTMLElement>("[data-sign-in-replace-cancel]") ?? true
      }
    >
      <DialogHeader>
        <DialogTitle>
          {title !== undefined
            ? `Sign in ${title}`
            : mateName === null
              ? "Sign this Mate in"
              : `Sign ${mateName} in`}
        </DialogTitle>
      </DialogHeader>
      <DialogPanel>{children}</DialogPanel>
    </DialogPopup>
  );
}
