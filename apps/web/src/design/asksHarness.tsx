/**
 * Mate Asks: every verb on the board ("Mate Asks", 2026-11-04) in every state, built from the ask
 * kit — approve on production, provide (the vault ask itself), connect as steps with the paste
 * fallback, reveal, and an organization's proposal with "Only Juno" — in the conversation's
 * column at the owner's size (1786 wide, the left menu at 435, `?menu=` for another). `Full` draws
 * each as the conversation does; `Compact` as above the composer while the Mate is stopped on it.
 * `?theme=dark`, `?density=compact`.
 *
 * Served by the dev server at `/design-asks.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import { type ReactNode, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  type AskState,
  type AskWhere,
  askWhomWords,
  authorityWords,
  isProduction,
} from "~/components/ask/ask.logic";
import {
  AskCard,
  type AskDensity,
  AskFacts,
  AskFooter,
  type AskFooterProps,
  AskSteps,
} from "~/components/ask/AskCard";
import { AskRevealed } from "~/components/ask/AskSecret";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { MateFace } from "~/components/zerops/primitives";
import { VaultAsk } from "~/components/zerops/vault/VaultAsk";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "~/components/zerops/vault/vaultFixture";
import {
  type VaultAsk as VaultAskModel,
  type VaultAskSource,
  vaultAskState,
  vaultAskView,
} from "~/components/zerops/vault/vaultRequest.logic";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const MENU = Number(params.get("menu") ?? 435);
const MATE = "Juno";
const FACE = <MateFace size={24} state="needs" tint="sky" />;

/** A row of state chips over a specimen. */
function States<S extends string>(props: {
  readonly label: string;
  readonly states: ReadonlyArray<readonly [S, string]>;
  readonly value: S;
  readonly onChange: (state: S) => void;
}) {
  return (
    <ToggleGroup
      aria-label={props.label}
      onValueChange={(next) => {
        const picked = props.states.find(([state]) => state === next[0]);
        if (picked !== undefined) props.onChange(picked[0]);
      }}
      value={[props.value]}
    >
      {props.states.map(([state, words]) => (
        <ToggleGroupItem key={state} value={state}>
          {words}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

/** One specimen: its name, its state chips, and the card as the chosen density draws it. */
function Specimen(props: {
  readonly name: string;
  readonly chips: ReactNode;
  readonly density: AskDensity;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid min-w-0 gap-3" data-harness-specimen={props.name}>
      <h2 className="font-medium text-body text-muted-foreground">{props.name}</h2>
      {props.chips}
      {props.density === "compact" ? (
        // The composer's own frame, the ask at its top.
        <div className="w-full overflow-hidden rounded-3xl border border-border bg-card">
          {props.children}
          <div className="px-4 pt-3 pb-10 text-placeholder text-sm">Ask anything...</div>
        </div>
      ) : (
        props.children
      )}
    </section>
  );
}

/** A kit card for a specimen: one footer per state, the presses doing nothing. */
function Card(props: {
  readonly id: string;
  readonly density: AskDensity;
  readonly where: AskWhere;
  readonly title: string;
  readonly why: string;
  readonly state: AskState;
  readonly footer: Omit<AskFooterProps, "state" | "density">;
  readonly children?: ReactNode;
}) {
  return (
    <AskCard
      askId={props.id}
      density={props.density}
      face={FACE}
      footer={
        <AskFooter
          density={props.density}
          destructive={isProduction(props.where)}
          state={props.state}
          {...props.footer}
        />
      }
      kind={props.id}
      onShowInConversation={props.density === "compact" ? () => undefined : undefined}
      state={props.state.kind}
      title={props.title}
      where={props.where}
      why={{ who: MATE, words: props.why }}
    >
      {props.children}
    </AskCard>
  );
}

const quiet = (
  density: AskDensity,
  words: string,
  variant: "secondary" | "ghost" = "secondary",
) => (
  <Button size={density === "compact" ? "sm" : "md"} variant={variant}>
    {words}
  </Button>
);

const NOTHING = () => undefined;

// ── approve, on production ───────────────────────────────────────────────────────────────────

const APPROVE_STATES = [
  ["waiting", "Waiting on you"],
  ["working", "Working"],
  ["done", "Done"],
  ["notNow", "Not now"],
  ["failed", "Failed"],
  ["othersToAnswer", "Someone else's to answer"],
  ["replaced", "Replaced"],
] as const;
type ApproveState = (typeof APPROVE_STATES)[number][0];
const PRODUCTION_RULE = "Only people with production access can set this.";
const CAN_SET = ["Petr", "Jana"];

const APPROVE: Readonly<Record<ApproveState, AskState>> = {
  waiting: { kind: "waiting" },
  working: { kind: "working", words: "Setting on production…", pressed: "main" },
  done: { kind: "done", words: "Set on production by Aleš · api restarted at 15:02", told: null },
  notNow: { kind: "notNow", words: "Not now · Aleš, 15:04" },
  failed: {
    kind: "failed",
    words: "Zerops refused: api is mid-deploy. Try again when it finishes.",
  },
  othersToAnswer: { kind: "othersToAnswer", words: authorityWords(PRODUCTION_RULE, CAN_SET) },
  replaced: { kind: "replaced", words: `${MATE} asked again below with a different value.` },
};

function Approve({ density }: { readonly density: AskDensity }) {
  const [state, setState] = useState<ApproveState>("waiting");
  const askWhom = askWhomWords(CAN_SET);
  return (
    <Specimen
      chips={<States label="Approve" onChange={setState} states={APPROVE_STATES} value={state} />}
      density={density}
      name="Approve, on production"
    >
      <Card
        density={density}
        footer={{
          main: { label: "Set on production", onPress: NOTHING },
          onNotNow: NOTHING,
          action:
            state === "failed"
              ? quiet(density, "Try again")
              : state === "othersToAnswer" && askWhom !== null
                ? quiet(density, askWhom)
                : undefined,
        }}
        id="approve"
        state={APPROVE[state]}
        title="Set PAYMENT_MODE on production"
        where={{ scope: "production", detail: "api" }}
        why="Stripe live keys are in place, so checkout can leave test mode."
      >
        {density === "full" ? (
          <AskFacts
            rows={[
              { label: "PAYMENT_MODE", was: "test", value: "live" },
              { label: "restarts", value: "api (2 containers)" },
            ]}
          />
        ) : undefined}
      </Card>
    </Specimen>
  );
}

// ── provide: the vault ask itself ────────────────────────────────────────────────────────────

const PROVIDE_STATES = [
  ["waiting", "Waiting on you"],
  ["working", "Working"],
  ["done", "Done"],
  ["notNow", "Not now"],
  ["failed", "Failed"],
  ["given", "Given in the Vault"],
  ["reserved", "A name the Mate keeps"],
] as const;
type ProvideState = (typeof PROVIDE_STATES)[number][0];

const asked = (over: Partial<VaultAskModel> = {}): VaultAskModel => ({
  key: "STRIPE_TEST_KEY",
  label: "Stripe secret key (starts with sk_test_)",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "The checkout test needs Stripe's test secret key.",
  askedAt: new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString(),
  ...over,
});
const ALES = { by: { kind: "person", subject: "user-ales" }, at: VAULT_FIXTURE_NOW } as const;

function provideSource(state: ProvideState): VaultAskSource {
  const ask =
    state === "given" || state === "done"
      ? asked({ key: "STRIPE_SECRET_KEY" })
      : state === "reserved"
        ? asked({ key: "MATE_PROBE_TOKEN", label: "Probe token" })
        : asked();
  return {
    ask,
    mateName: MATE,
    record:
      state === "done"
        ? { state: "saved", answer: ALES }
        : state === "notNow"
          ? { state: "declined", answer: ALES }
          : { state: "open", answer: null },
    vault: vaultAskState(VAULT_FIXTURE, ask),
    pending: state === "working" ? "save" : null,
    refusal: state === "failed" ? "Zerops refused it: the key exists already." : null,
    nameOf: (subject) => (subject === "user-ales" ? "Aleš" : undefined),
    clock: () => "15:11",
  };
}

function Provide({ density }: { readonly density: AskDensity }) {
  const [state, setState] = useState<ProvideState>("waiting");
  const source = provideSource(state);
  return (
    <Specimen
      chips={<States label="Provide" onChange={setState} states={PROVIDE_STATES} value={state} />}
      density={density}
      name="Provide: the vault ask"
    >
      <VaultAsk
        ask={source.ask}
        askId="provide"
        density={density}
        face={FACE}
        key={state}
        mateName={MATE}
        onNotNow={NOTHING}
        onSave={async () => true}
        onShowInConversation={density === "compact" ? NOTHING : undefined}
        onUseGiven={NOTHING}
        vault={source.vault}
        view={vaultAskView(source)}
      />
    </Specimen>
  );
}

// ── connect, as steps ────────────────────────────────────────────────────────────────────────

const CONNECT_STATES = [
  ["waiting", "Waiting on you"],
  ["signing", "Signing in"],
  ["paste", "Paste fallback"],
  ["done", "Connected"],
  ["failed", "Failed"],
] as const;
type ConnectState = (typeof CONNECT_STATES)[number][0];

const CONNECT: Readonly<Record<ConnectState, AskState>> = {
  waiting: { kind: "waiting" },
  signing: { kind: "working", words: "Finish signing in on the Linear tab.", pressed: null },
  paste: { kind: "waiting" },
  done: {
    kind: "done",
    words: "Connected · 23 tools · for Claude and Codex",
    told: `${MATE} hears: Linear is connected for Claude and Codex`,
  },
  failed: {
    kind: "failed",
    words: "Linear didn't sign in: that address belongs to an older sign-in.",
  },
};

function Connect({ density }: { readonly density: AskDensity }) {
  const [state, setState] = useState<ConnectState>("waiting");
  const added = state !== "waiting";
  return (
    <Specimen
      chips={<States label="Connect" onChange={setState} states={CONNECT_STATES} value={state} />}
      density={density}
      name="Connect, as steps"
    >
      <Card
        density={density}
        footer={
          state === "paste"
            ? {
                main: { label: "Finish", onPress: NOTHING },
                also: quiet(density, "Start again", "ghost"),
              }
            : {
                main: { label: "Add and sign in", onPress: NOTHING },
                onNotNow: NOTHING,
                action:
                  state === "signing"
                    ? quiet(density, "Open it again")
                    : state === "failed"
                      ? quiet(density, "Sign in again")
                      : undefined,
              }
        }
        id="connect"
        state={CONNECT[state]}
        title={`Set up Linear for ${MATE}`}
        where={{ scope: "mate", detail: null }}
        why="So I can read the issues on the Checkout board and update them as I fix them."
      >
        <AskSteps
          steps={[
            {
              id: "add",
              label: "Add Linear",
              detail: "mcp.linear.app/mcp",
              state: added ? "done" : "now",
              end: added ? "Added" : undefined,
            },
            {
              id: "sign-in",
              label: "Sign in to Linear",
              detail: `as you; ${MATE} uses your access`,
              state: state === "done" ? "done" : added ? "now" : "next",
              end: state === "done" ? "Signed in as Aleš" : undefined,
            },
          ]}
        />
        {state === "paste" ? (
          <label className="grid gap-1.5 text-caption text-muted-foreground">
            Linear sent you to a page that didn't load. Paste its address here.
            <Input defaultValue="http://localhost:53365/callback?code=…" size="sm" />
          </label>
        ) : null}
      </Card>
    </Specimen>
  );
}

// ── reveal ───────────────────────────────────────────────────────────────────────────────────

const REVEAL_STATES = [
  ["waiting", "Waiting on you"],
  ["confirm", "Confirm on device"],
  ["revealed", "Revealed"],
  ["hidden", "Hidden again"],
  ["othersToAnswer", "Someone else's to answer"],
] as const;
type RevealState = (typeof REVEAL_STATES)[number][0];
const CAN_REVEAL = ["Petr"];
/** An example value, never a real one. */
const REVEALED = ["Hk7q", "2mVz", "example", "only"].join("-");

const REVEAL: Readonly<Record<RevealState, AskState>> = {
  waiting: { kind: "waiting" },
  confirm: { kind: "working", words: "Confirm on your signed-in device to reveal.", pressed: null },
  revealed: { kind: "done", words: "Only on your screen · recorded at HQ", told: null },
  hidden: { kind: "done", words: "Revealed to Aleš at 15:32 · hidden again", told: null },
  othersToAnswer: {
    kind: "othersToAnswer",
    words: authorityWords("Only people with production access can reveal this.", CAN_REVEAL),
  },
};

function Reveal({ density }: { readonly density: AskDensity }) {
  const [state, setState] = useState<RevealState>("waiting");
  const askWhom = askWhomWords(CAN_REVEAL);
  return (
    <Specimen
      chips={<States label="Reveal" onChange={setState} states={REVEAL_STATES} value={state} />}
      density={density}
      name="Reveal"
    >
      <Card
        density={density}
        footer={{
          main: { label: "Reveal production value", onPress: () => setState("confirm") },
          onNotNow: NOTHING,
          note: "Only on your screen",
          action:
            state === "revealed"
              ? quiet(density, "Hide", "ghost")
              : state === "hidden"
                ? quiet(density, "Reveal again")
                : state === "othersToAnswer" && askWhom !== null
                  ? quiet(density, askWhom)
                  : undefined,
        }}
        id="reveal"
        state={REVEAL[state]}
        title="Show DATABASE_PASSWORD from production"
        where={{ scope: "production", detail: "db" }}
        why="You asked for it to connect from your laptop. I can't see it; only you can."
      >
        {state === "revealed" ? (
          <AskRevealed onHide={() => setState("hidden")} value={REVEALED} />
        ) : undefined}
      </Card>
    </Specimen>
  );
}

// ── an organization's proposal, narrowed by the approver ─────────────────────────────────────

const SCOPE_STATES = [
  ["waiting", "You can approve"],
  ["othersToAnswer", "Someone else's to answer"],
  ["done", "Done"],
  ["narrowed", "Narrowed"],
] as const;
type ScopeState = (typeof SCOPE_STATES)[number][0];

const SCOPE: Readonly<Record<ScopeState, AskState>> = {
  waiting: { kind: "waiting" },
  othersToAnswer: {
    kind: "othersToAnswer",
    words: `Owners and Admins approve organization changes. You can still add it for ${MATE}.`,
  },
  done: {
    kind: "done",
    words:
      "Added for the organization by Aleš · each Mate shows it under MCP, waiting for its sign-in",
    told: null,
  },
  narrowed: { kind: "done", words: `Added for ${MATE} only by Aleš`, told: null },
};

function OrganizationScope({ density }: { readonly density: AskDensity }) {
  const [state, setState] = useState<ScopeState>("waiting");
  const onlyJuno = quiet(density, `Only ${MATE}`);
  return (
    <Specimen
      chips={
        <States
          label="Organization scope"
          onChange={setState}
          states={SCOPE_STATES}
          value={state}
        />
      }
      density={density}
      name="An organization's proposal, narrowed"
    >
      <Card
        density={density}
        footer={{
          main: { label: "Add for the organization", onPress: NOTHING },
          also: onlyJuno,
          onNotNow: NOTHING,
          action: state === "othersToAnswer" ? onlyJuno : undefined,
        }}
        id="scope"
        state={SCOPE[state]}
        title="Add Sentry for every Mate in Acme"
        where={{ scope: "organization", detail: "Acme" }}
        why="Every project here reports to the same Sentry organization, so every Mate could read its errors."
      >
        {density === "full" ? (
          <AskFacts
            rows={[
              { label: "server", value: "sentry · mcp.sentry.dev/mcp" },
              { label: "signs in", value: "each Mate signs in itself" },
              { label: "reaches", value: "14 Mates in 9 projects" },
            ]}
          />
        ) : undefined}
      </Card>
    </Specimen>
  );
}

function Harness() {
  const [density, setDensity] = useState<AskDensity>(
    params.get("density") === "compact" ? "compact" : "full",
  );
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1 overflow-y-auto px-5 py-8">
        <div className="mx-auto grid w-full max-w-3xl gap-10">
          <header className="grid gap-3">
            <h1 className="font-medium text-title">Mate Asks</h1>
            <States
              label="Density"
              onChange={setDensity}
              states={[
                ["full", "In the conversation"],
                ["compact", "Above the composer"],
              ]}
              value={density}
            />
          </header>
          <Approve density={density} />
          <Provide density={density} />
          <Connect density={density} />
          <Reveal density={density} />
          <OrganizationScope density={density} />
        </div>
      </div>
    </div>
  );
}

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
