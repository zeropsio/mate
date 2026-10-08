import type { OtherAgentFields } from "@t3tools/client-runtime/zerops/agentLogin";
import { EnvironmentId, type ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

/** A provider instance as the server sends it: signed in, models listed, unless said otherwise. */
const agentInstance = (driver: string, status = "ready"): OtherAgentFields =>
  ({
    driver,
    enabled: true,
    installed: true,
    status,
    auth: { status: status === "ready" ? "authenticated" : "unauthenticated" },
    models: [{ slug: "m" }],
  }) as unknown as OtherAgentFields;

const feedState = vi.hoisted(() => ({
  agentAuth: undefined as unknown,
  viewer: undefined as string | undefined,
  threads: [] as ReadonlyArray<Record<string, unknown>>,
  names: new Map<string, string>(),
  providers: [] as ReadonlyArray<OtherAgentFields>,
}));

vi.mock("../../zerops/useMateStandUp", () => ({
  useMateStandUp: () => ({ sendFailed: false, retrying: false, retry: async () => undefined }),
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsAgentAuth: () => feedState.agentAuth,
}));

vi.mock("../../zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () =>
    feedState.viewer === undefined ? null : { user: { id: feedState.viewer } },
}));

vi.mock("../../state/entities", () => ({
  useServerConfigs: () => new Map([["environment-1", { providers: feedState.providers }]]),
  useThreadShells: () => feedState.threads,
}));

vi.mock("../../zerops/useZeropsEnvironmentProject", () => ({
  useZeropsEnvironmentProject: () => ({ projectId: "p-fen", orgId: "org-acme" }),
}));

vi.mock("../../zerops/useZeropsMateOwners", () => ({
  useHqPersonNames: () => (userId: string) => feedState.names.get(userId),
}));

// The sign-in module is its own (`ZeropsAgentSignIn.test.tsx`): here only where it stands.
vi.mock("./ZeropsAgentSignIn", () => ({
  ZeropsAgentSignIn: () => <div data-sign-in-module />,
}));

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";

import type { ZeropsMateIdentity } from "../../zerops/mateIdentities";
import { MateEmptyStateView, ZeropsMateEmptyState } from "./ZeropsMateEmptyState";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const MAIN = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("thread-main"));
const SECOND = scopeThreadRef(ENVIRONMENT_ID, ThreadId.make("thread-second"));
const ADA = "u-ada";

const MATE: ZeropsMateIdentity = {
  name: "Fen",
  tint: "olive",
  shape: "seal",
  project: "Acme Docs",
  projectUrl: "https://app.zerops.example/project/p1",
  connected: true,
};
const ASKED: ZeropsMateIdentity = { ...MATE, standUp: { by: ADA } };
/** Made by Ada, with no stand-up asked: New project's first Mate. */
const MADE: ZeropsMateIdentity = { ...MATE, madeBy: ADA };

const NOT_SIGNED_IN: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: (["claude-code", "codex"] as const).map((agentId) => ({
    agentId,
    credPresent: false,
    flagOAuth: false,
    flagToken: false,
    providerAuth: "unknown" as const,
    state: "not-authorized" as const,
  })),
};

const SIGNED_IN_BY_ADA: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
      authorizedBy: { subject: ADA },
    },
  ],
};

const known = (value: ZeropsAgentAuthSnapshot): Known<ZeropsAgentAuthSnapshot> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 0 },
  coverage: "complete",
  freshness: { kind: "live" },
});

const READING = { state: "reading", sinceMs: 0, attempt: 1 };

const shell = (id: string, createdAt: string) => ({
  id,
  environmentId: ENVIRONMENT_ID,
  archivedAt: null,
  createdAt,
  updatedAt: createdAt,
  latestUserMessageAt: null,
});

const render = (mate: ZeropsMateIdentity = MATE, threadRef = MAIN) =>
  renderToStaticMarkup(
    <ZeropsMateEmptyState environmentId={ENVIRONMENT_ID} mate={mate} threadRef={threadRef} />,
  );

/** What a person reads of some markup: its text, entities decoded, names' glue undone. */
const readable = (markup: string) =>
  markup
    .replaceAll("<!-- -->", "")
    .replace(/<[^>]+>/gu, "")
    .replaceAll("&#x27;", "'")
    .replaceAll(" ", " ");

/** The stage as a person reads it: its headline, its sentence, its face, and what its slot holds. */
const stage = (html: string) => ({
  headline: readable(/<h1[^>]*>(.*?)<\/h1>/u.exec(html)?.[1] ?? ""),
  sentence: readable(
    /<p[^>]*(?:class="arrival-sentence"|data-arrival-secondary="")[^>]*>(.*?)<\/p>/u.exec(
      html,
    )?.[1] ?? "",
  ),
  face: /data-mate-face-state="(\w+)"/u.exec(html)?.[1],
  signIn: html.includes("data-sign-in-module"),
});

const CURSOR_READY = [agentInstance("cursor")];

describe("ZeropsMateEmptyState", () => {
  beforeEach(() => {
    feedState.agentAuth = undefined;
    feedState.viewer = ADA;
    feedState.names = new Map();
    feedState.providers = [];
    feedState.threads = [
      shell("thread-main", "2026-09-29T10:00:00.000Z"),
      shell("thread-second", "2026-09-29T09:00:00.000Z"),
    ];
  });

  it("leaves the conversation's one face in its header while retaining sign-in content", () => {
    feedState.agentAuth = known(NOT_SIGNED_IN);
    const html = render();
    expect(html).not.toContain("data-mate-face-state");
    expect(stage(html).signIn).toBe(true);
  });

  it("an unread agent-auth feed never renders as nothing to sign in: it says it is checking", () => {
    feedState.agentAuth = READING;
    const html = render(ASKED);

    expect(html).toContain("Checking which coding agents are signed in…");
    expect(html).toContain("animation-delay:400ms");
    expect(stage(html).signIn).toBe(false);
  });

  it("a failed agent-auth read says why", () => {
    feedState.agentAuth = {
      state: "failed",
      failure: { kind: "unsupported", capability: "subscribeZeropsAgentAuth" },
      atMs: 0,
      attempt: 1,
      retryAtMs: null,
    };

    expect(render(ASKED)).toContain("This Mate is too old for this. Updating it adds it.");
  });

  it.each([
    {
      name: "a Mate just added, to the person who added it, before the sign-in",
      mate: ASKED,
      auth: known(NOT_SIGNED_IN),
      headline: "Sign Fen in to start.",
      sentence: "Once it's signed in, Fen stands up development on Acme Docs.",
      signIn: true,
    },
    {
      name: "signed in, the ask on its way",
      mate: ASKED,
      auth: known(SIGNED_IN_BY_ADA),
      headline: "Fen is standing up development on Acme Docs.",
      sentence: "Signed in. It starts in a moment.",
      signIn: false,
    },
    {
      name: "a colleague opening a Mate its person has not signed in",
      mate: ASKED,
      viewer: "u-mira",
      names: [[ADA, "Ada"]] as const,
      auth: known(NOT_SIGNED_IN),
      headline: "Sign Fen in to start.",
      sentence:
        "Ada added Fen but hasn't signed it in. Sign it in with your own account and it's yours.",
      signIn: true,
    },
    {
      name: "a colleague opening a Mate its maker has not signed in, whichever flow made it",
      mate: MADE,
      viewer: "u-mira",
      names: [[ADA, "Ada"]] as const,
      auth: known(NOT_SIGNED_IN),
      headline: "Sign Fen in to start.",
      sentence:
        "Ada added Fen but hasn't signed it in. Sign it in with your own account and it's yours.",
      signIn: true,
    },
    {
      name: "the same, its person's name not read",
      mate: ASKED,
      viewer: "u-mira",
      auth: known(NOT_SIGNED_IN),
      headline: "Sign Fen in to start.",
      sentence: "Nobody has signed Fen in yet. Sign it in with your own account and it's yours.",
      signIn: true,
    },
    {
      name: "another of the Mate's chats, nobody signed in",
      mate: ASKED,
      thread: SECOND,
      auth: known(NOT_SIGNED_IN),
      headline: "Sign Fen in to start.",
      sentence: "Once it's signed in, Fen writes and runs code on its own copy of Acme Docs.",
      signIn: true,
    },
    {
      name: "a Mate nobody asked it of, nobody signed in",
      mate: MATE,
      auth: known(NOT_SIGNED_IN),
      headline: "Sign Fen in to start.",
      sentence: "Once it's signed in, Fen writes and runs code on its own copy of Acme Docs.",
      signIn: true,
    },
    {
      name: "a Mate signed in, ready",
      mate: MATE,
      auth: known(SIGNED_IN_BY_ADA),
      headline: "What should Fen do on Acme Docs?",
      sentence: "",
      signIn: false,
    },
    // Mate signs people in to Claude Code and Codex only; an agent outside the sign-in that is
    // ready is one to run, for anybody.
    {
      name: "a Mate just added, nobody signed in, Cursor ready",
      mate: ASKED,
      auth: known(NOT_SIGNED_IN),
      providers: CURSOR_READY,
      headline: "Fen is standing up development on Acme Docs.",
      sentence: "Its agent is ready. It starts in a moment.",
      signIn: false,
    },
    {
      name: "a colleague opening a Mate on Cursor its person has not signed in",
      mate: ASKED,
      viewer: "u-mira",
      auth: known(NOT_SIGNED_IN),
      providers: CURSOR_READY,
      headline: "What should Fen do on Acme Docs?",
      sentence: "",
      signIn: false,
    },
    {
      name: "a Mate nobody asked it of, nobody signed in, OpenCode ready",
      mate: MATE,
      auth: known(NOT_SIGNED_IN),
      providers: [agentInstance("opencode")],
      headline: "What should Fen do on Acme Docs?",
      sentence: "",
      signIn: false,
    },
  ])("says, for $name: $headline", (row) => {
    feedState.agentAuth = row.auth;
    feedState.providers = row.providers ?? [];
    if (row.viewer !== undefined) feedState.viewer = row.viewer;
    if (row.names !== undefined) feedState.names = new Map(row.names);
    const html = render(row.mate, row.thread);

    expect(stage(html)).toEqual({
      headline: row.headline,
      sentence: row.sentence,
      face: undefined,
      signIn: row.signIn,
    });
    // One heading, and no second voice: no status rows under a sign-in (the owner: "this state
    // shouldn't exist").
    expect(html.match(/<h1/gu)).toHaveLength(1);
    expect(html).not.toContain("Not signed in");
  });

  it("waits on the sign-in's read with the sign-in's own headline", () => {
    feedState.agentAuth = READING;
    expect(stage(render(ASKED)).headline).toBe("Sign Fen in to start.");
  });

  it("breaks the headline between its clauses, never inside the project's name", () => {
    feedState.agentAuth = known(SIGNED_IN_BY_ADA);
    const html = render({ ...ASKED, project: "Acme Docs Portal" });

    expect(html).toContain("Fen is standing up development on Acme Docs Portal.");
  });
});

// A new Mate's own view while it comes up is the same stage before the conversation exists
// (`ZeropsMateComingPage`): the same face in the same place, its headline saying it is coming up,
// the view's own sentence under it and its steps in the slot. When it is up the words hand over
// to the state it moves into.
describe("MateEmptyStateView — a Mate coming up", () => {
  const COMING_UP: ZeropsMateIdentity = { ...ASKED, connected: false };
  const view = (props: Partial<Parameters<typeof MateEmptyStateView>[0]> = {}) =>
    renderToStaticMarkup(
      <MateEmptyStateView
        mate={COMING_UP}
        phase="sign-in"
        signIn={null}
        signInRequired={false}
        unknown={null}
        {...props}
      />,
    );
  const progress = <ol data-coming-progress />;

  it("says it is coming up, waking, how long is left, its steps in the slot", () => {
    const html = view({
      coming: {
        kind: "coming",
        sentence: "About two minutes.",
        below: progress,
      },
    });
    expect(stage(html)).toMatchObject({
      headline: "Fen is coming up on Acme Docs.",
      sentence: "About two minutes.",
      face: "waking",
      signIn: false,
    });
    expect(html).toMatch(/data-arrival-slot="coming".*data-coming-progress/u);
  });

  it("says a Mate that did not come could not be added, asking for the person", () => {
    const html = view({
      coming: { kind: "failed", sentence: "Could not be created.", below: progress },
    });
    expect(stage(html)).toMatchObject({
      headline: "Fen could not be added to Acme Docs.",
      sentence: "Could not be created.",
      face: "needs",
    });
  });

  it("once up, hands its words over to the sign-in, the sign-in in the slot where the steps stood", () => {
    const html = view({
      // Just up: it arrives until its first sign-in.
      mate: { ...ASKED, arrivingUntil: Date.now() + 600_000 },
      coming: { kind: "coming", over: true, below: progress },
      signIn: <div data-sign-in-module />,
      signInRequired: true,
    });
    expect(stage(html)).toMatchObject({
      headline: "Sign Fen in to start.",
      face: "waking",
      signIn: true,
    });
    expect(html).not.toContain("data-coming-progress");
  });

  // The dev halves' first deploys and a utility's build run minutes past the sign-in (measured
  // 2026-09-30: until +264 s and +316 s, the sign-in at +170 s): the person sees them come up.
  const RUNTIMES = [
    { hostname: "appdev", role: "dev" as const, service: { id: "s-1", status: "CREATING" } },
    { hostname: "appstage", role: "stage" as const, service: { id: "s-2", status: "ACTIVE" } },
  ];
  const runtimesLine = (html: string) =>
    /data-zerops-surface="arrival-runtimes"[^>]*>(.*?)<\/div>/u
      .exec(html)?.[1]
      ?.replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();

  it("names the runtimes still coming up under the sign-in", () => {
    const html = view({
      // Just up: it arrives until its first sign-in.
      mate: { ...ASKED, arrivingUntil: Date.now() + 600_000 },
      coming: { kind: "coming", over: true, below: progress },
      signIn: <div data-sign-in-module />,
      signInRequired: true,
      runtimes: RUNTIMES,
    });
    expect(runtimesLine(html)).toBe("appdev appstage coming up");
  });

  it.each([
    {
      case: "once signed in: the stand-up's run card carries the builds",
      phase: "standing-up" as const,
      runtimes: RUNTIMES,
    },
    {
      case: "for runtimes already up",
      phase: "sign-in" as const,
      runtimes: RUNTIMES.map((runtime) => ({
        ...runtime,
        service: { ...runtime.service, status: "ACTIVE" },
      })),
    },
  ])("names none $case", ({ phase, runtimes }) => {
    const html = view({
      mate: ASKED,
      phase,
      signIn: <div data-sign-in-module />,
      signInRequired: phase === "sign-in",
      runtimes,
    });
    expect(runtimesLine(html)).toBeUndefined();
  });

  it("names any other Mate on its way to its conversation, its line under it", () => {
    const html = view({
      mate: MATE,
      phase: null,
      coming: { kind: "reaching", below: <p data-opening>Reconnecting…</p> },
    });
    expect(stage(html)).toMatchObject({
      headline: "Fen is opening the conversation.",
      sentence: "Picking up where you left off.",
      face: "sleep",
    });
    expect(html).toContain("data-opening");
  });

  it("holds an unnamed Mate's face and headline places, empty, with its line under them", () => {
    const named = view({
      mate: MATE,
      phase: null,
      coming: { kind: "reaching", below: <p data-opening>Reconnecting…</p> },
    });
    const unnamed = view({
      mate: null,
      phase: null,
      coming: { kind: "reaching", below: <p data-opening>Reconnecting…</p> },
    });
    expect(stage(unnamed).headline).toBe("The Mate is opening the conversation.");
    expect(unnamed).toContain("data-mate-face-reserved");
    expect(unnamed).toContain("data-opening");
    // The same elements in the same order: nothing moves when the name arrives.
    const shape = (html: string) => html.match(/<(\w+)[^>]*data-(?:mate-empty-lead|arrival-\w+)/gu);
    expect(shape(unnamed)).toEqual(shape(named));
  });
});

it("a failed stand-up send says what failed and offers a manual Try again", () => {
  const html = renderToStaticMarkup(
    <MateEmptyStateView
      mate={MATE}
      phase="standing-up"
      signIn={null}
      signInRequired={false}
      unknown={null}
      standUpFailure={{ retrying: false, retry: () => undefined }}
    />,
  );
  expect(html).toContain("The message to Fen didn&#x27;t go through.");
  expect(html).toContain("Try again");
  expect(html).not.toContain("Fen is standing up development");
});
