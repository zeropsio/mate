import { EnvironmentId, type ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const feedState = vi.hoisted(() => ({
  agentAuth: undefined as unknown,
  viewer: undefined as string | undefined,
  attempt: "none" as "none" | "sending" | "failed",
  threads: [] as ReadonlyArray<Record<string, unknown>>,
}));

vi.mock("../../zerops/useZeropsFeeds", () => ({
  useZeropsAgentAuth: () => feedState.agentAuth,
}));

vi.mock("../../zerops/useZeropsAgentSignInDialog", () => ({
  useZeropsAgentSignInDialog: () => ({
    openFor: () => {},
    dialog: null,
    recordFailed: new Set(),
    retryRecord: () => {},
  }),
}));

vi.mock("../../zerops/useAgentLoginCancel", () => ({
  useAgentLoginCancel: () => () => {},
}));

vi.mock("../../zerops/ZeropsSessionProvider", () => ({
  useZeropsSessionOptional: () =>
    feedState.viewer === undefined ? null : { user: { id: feedState.viewer } },
}));

vi.mock("../../zerops/useMateStandUp", () => ({
  useMateStandUpAttempt: () => feedState.attempt,
  retryMateStandUp: () => {},
}));

vi.mock("../../state/entities", () => ({
  useThreadShells: () => feedState.threads,
}));

vi.mock("./ZeropsAgentAuthCard", () => ({
  ZeropsAgentAuthRows: ({ snapshot }: { readonly snapshot: ZeropsAgentAuthSnapshot }) => (
    <ul data-zerops-agent-auth-rows>
      {snapshot.agents.map((agent) => (
        <li key={agent.agentId}>{agent.agentId}</li>
      ))}
    </ul>
  ),
}));

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";

import type { ZeropsMateIdentity } from "../../zerops/mateIdentities";
import { markMateHandedOver } from "../../zerops/mateHandOver";
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
  projectUrl: "https://app.zerops.io/project/p1",
  connected: true,
};
const ASKED: ZeropsMateIdentity = { ...MATE, standUp: { by: ADA } };

const NOT_SIGNED_IN: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
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
    .replaceAll("\u00a0", " ");

/**
 * Whether a person can read and press the sign-in rows: under the question whenever drawn; under
 * a stand-up only in the layer shown — a sign-in landing fades them where they stand.
 */
const rowsReadable = (html: string) => {
  if (
    !html.includes("data-zerops-agent-auth-rows") &&
    !html.includes('data-zerops-surface="mate-standup-authorize"')
  ) {
    return false;
  }
  const layer =
    /data-standup-layer="(\w+)"[^>]*><section[^>]*data-zerops-surface="mate-sign-in"/u.exec(
      html,
    )?.[1];
  return layer === undefined || layer === "shown";
};

/** The heading a person reads: the question, or the stand-up's phase in view. */
const headline = (html: string) => {
  const heading = /<h1[^>]*>(.*?)<\/h1>/u.exec(html)?.[1];
  return heading === undefined ? undefined : readable(heading);
};

/** The stand-up's phases, in order: where each stands, whether a person can read it, its words. */
const phrases = (html: string) =>
  [
    ...html.matchAll(
      /<div( aria-hidden="true")? class="[^"]*" data-standup-phrase="(\w+)"( inert="")?>(.*?)<\/div>/gu,
    ),
  ].map(([, hidden, place, inert, markup]) => ({
    readable: hidden === undefined && inert === undefined,
    place,
    words: readable(/<(?:h1|p)[^>]*>(.*?)<\/(?:h1|p)>/u.exec(markup ?? "")?.[1] ?? ""),
    retry: (markup ?? "").includes("data-mate-standup-retry"),
  }));

describe("ZeropsMateEmptyState", () => {
  beforeEach(() => {
    feedState.agentAuth = undefined;
    feedState.viewer = ADA;
    feedState.attempt = "none";
    feedState.threads = [
      shell("thread-main", "2026-09-29T10:00:00.000Z"),
      shell("thread-second", "2026-09-29T09:00:00.000Z"),
    ];
  });

  it("wears the face its person picked", () => {
    const html = render();
    expect(html).toContain('data-mate-face-tint="olive"');
    expect(html).toContain('data-mate-face-shape="seal"');
  });

  it("an unread agent-auth feed never renders as nothing to sign in: it says it is checking", () => {
    feedState.agentAuth = READING;
    const html = render();

    expect(html).toContain("Checking which coding agents are signed in…");
    expect(html).toContain("animation-delay:400ms");
    expect(html).not.toContain('data-zerops-surface="mate-sign-in"');
  });

  it("a failed agent-auth read says why", () => {
    feedState.agentAuth = {
      state: "failed",
      failure: { kind: "unsupported", capability: "subscribeZeropsAgentAuth" },
      atMs: 0,
      attempt: 1,
      retryAtMs: null,
    };

    expect(render()).toContain("This Mate is too old for this. Updating it adds it.");
  });

  it("a known snapshot with no agent signed in asks for a sign-in, stale or not", () => {
    const read: Known<ZeropsAgentAuthSnapshot> = {
      state: "known",
      value: NOT_SIGNED_IN,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: null },
        sinceMs: 0,
      },
    };
    feedState.agentAuth = read;
    const html = render();

    expect(html).toContain('data-zerops-surface="mate-sign-in"');
    expect(html).toContain("data-zerops-agent-auth-rows");
    expect(html).not.toContain("Checking which coding agents are signed in…");
  });

  it.each([
    {
      name: "a Mate just added, to the person who added it, before the sign-in",
      mate: ASKED,
      auth: known(NOT_SIGNED_IN),
      says: "Fen will stand up development on Acme Docs after you authorize your agent.",
      rows: true,
    },
    {
      name: "the same, while the sign-in is still being read",
      mate: ASKED,
      auth: READING,
      says: "Fen will stand up development on Acme Docs after you authorize your agent.",
      rows: false,
    },
    {
      name: "signed in, the message on its way",
      mate: ASKED,
      auth: known(SIGNED_IN_BY_ADA),
      says: "Fen is standing up development on Acme Docs…",
      rows: false,
    },
    {
      name: "the send asked of the composer",
      mate: ASKED,
      auth: known(SIGNED_IN_BY_ADA),
      attempt: "sending" as const,
      says: "Fen is standing up development on Acme Docs…",
      rows: false,
    },
    {
      name: "the send did not go through",
      mate: ASKED,
      auth: known(SIGNED_IN_BY_ADA),
      attempt: "failed" as const,
      says: "The message to Fen didn't go through.",
      rows: false,
    },
    {
      name: "a Mate in no project",
      mate: { ...ASKED, project: undefined },
      auth: known(NOT_SIGNED_IN),
      says: "Fen will stand up development on the project after you authorize your agent.",
      rows: true,
    },
    {
      name: "a colleague looking: the ask is its person's",
      mate: ASKED,
      viewer: "u-fen",
      auth: known(NOT_SIGNED_IN),
      says: "What should Fen do on Acme Docs?",
      rows: true,
    },
    {
      name: "another of the Mate's chats",
      mate: ASKED,
      thread: SECOND,
      auth: known(NOT_SIGNED_IN),
      says: "What should Fen do on Acme Docs?",
      rows: true,
    },
    {
      name: "a Mate nobody asked it of",
      mate: MATE,
      auth: known(NOT_SIGNED_IN),
      says: "What should Fen do on Acme Docs?",
      rows: true,
    },
  ])("says, for $name: $says", ({ mate, auth, attempt, viewer, thread, says, rows }) => {
    feedState.agentAuth = auth;
    if (attempt !== undefined) feedState.attempt = attempt;
    if (viewer !== undefined) feedState.viewer = viewer;
    const html = render(mate, thread);

    expect(headline(html)).toBe(says);
    expect(rowsReadable(html)).toBe(rows);
    // The stand-up's headline already says why an agent is needed.
    expect(html.includes("works through a coding agent")).toBe(
      rows && says.startsWith("What should"),
    );
    // Try again is there to press only when the send did not go through.
    expect(phrases(html).some((phrase) => phrase.readable && phrase.retry)).toBe(
      attempt === "failed",
    );
    // While the stand-up waits on the sign-in, its one message stands over the two buttons (the
    // owner: "the only message here"): no row repeats it with a status.
    const waitsOnSignIn = rows && !says.startsWith("What should");
    expect(html.includes('data-zerops-surface="mate-standup-authorize"')).toBe(waitsOnSignIn);
    if (waitsOnSignIn) {
      expect(html.includes("Authorize Codex")).toBe(true);
      expect(html.includes("data-zerops-agent-auth-rows")).toBe(false);
    }
  });

  it("keeps every stand-up phase in the headline's one box, only the one in view read", () => {
    feedState.agentAuth = known(SIGNED_IN_BY_ADA);
    feedState.attempt = "failed";
    const html = render(ASKED);

    expect(phrases(html)).toEqual([
      {
        readable: false,
        place: "past",
        words: "Fen will stand up development on Acme Docs after you authorize your agent.",
        retry: false,
      },
      {
        readable: false,
        place: "past",
        words: "Fen is standing up development on Acme Docs…",
        retry: false,
      },
      {
        readable: true,
        place: "shown",
        words: "The message to Fen didn't go through.",
        retry: true,
      },
    ]);
    // One heading, the phase in view's.
    expect(html.match(/<h1/gu)).toHaveLength(1);
  });

  it("breaks the headline between its clauses, never inside the project's name", () => {
    feedState.agentAuth = known(NOT_SIGNED_IN);
    const html = render({ ...ASKED, project: "Acme Docs Portal" });

    expect(html).toContain(
      '<span class="inline-block">Fen will stand up development on Acme\u00a0Docs\u00a0Portal</span> <span class="inline-block">after you authorize your agent.</span>',
    );
  });
});

// A new Mate's own view while it comes up is its empty conversation before the conversation
// exists (`ZeropsMateComingPage`): the same face in the same place, its headline saying it is
// coming up in the box the stand-up's phases share, and its progress where the sign-in will hang.
// When it is up, the words hand over in place — the phase it moves into was waiting after them.
describe("MateEmptyStateView — a Mate coming up", () => {
  const COMING_UP: ZeropsMateIdentity = { ...ASKED, connected: false };
  const view = (props: Partial<Parameters<typeof MateEmptyStateView>[0]> = {}) =>
    renderToStaticMarkup(
      <MateEmptyStateView
        mate={COMING_UP}
        onRetry={() => {}}
        phase="sign-in"
        signIn={null}
        signInRequired={false}
        unknown={null}
        {...props}
      />,
    );
  const progress = <span data-coming-progress>Starting the container</span>;

  it("says it is coming up as its heading, asleep, the phases it moves into waiting after it", () => {
    const html = view({ coming: { kind: "coming", below: progress } });
    expect(headline(html)).toBe("Fen is coming up on Acme Docs.");
    expect(phrases(html).map(({ place, readable }) => [place, readable])).toEqual([
      ["shown", true],
      ["next", false],
      ["next", false],
      ["next", false],
    ]);
    expect(html).toContain('data-mate-face-state="sleep"');
    // Its progress stands under its words, in its own phrase: it leaves with them.
    expect(html).toMatch(
      /data-standup-phrase="shown"[^>]*>.*data-mate-coming-below.*data-coming-progress/u,
    );
  });

  it("says a Mate that did not come could not be added, with what its view offers under it", () => {
    const html = view({ coming: { kind: "failed", below: progress } });
    expect(headline(html)).toBe("Fen could not be added to Acme Docs.");
  });

  it("waits with the question after it for anybody the stand-up is not theirs", () => {
    const html = view({ phase: null, coming: { kind: "coming", below: progress } });
    expect(phrases(html).map(({ place, words }) => [place, words])).toEqual([
      ["shown", "Fen is coming up on Acme Docs."],
      ["next", "What should Fen do on Acme Docs?"],
    ]);
  });

  it("handed over, keeps its coming words' room in the box, faded, and reads the phase", () => {
    const html = view({ mate: ASKED, coming: "past" });
    expect(headline(html)).toBe(
      "Fen will stand up development on Acme Docs after you authorize your agent.",
    );
    expect(phrases(html)[0]).toMatchObject({
      readable: false,
      place: "past",
      words: "Fen is coming up on Acme Docs.",
    });
    // The progress's room is kept, empty: the box is as tall as the view it came from.
    expect(html).toContain("data-mate-coming-below");
    expect(html).not.toContain("data-coming-progress");
  });

  it("keeps a question's heading as it always was where nothing came up", () => {
    const html = view({ mate: MATE, phase: null });
    expect(html).not.toContain("data-standup-headline");
    expect(headline(html)).toBe("What should Fen do on Acme Docs?");
  });

  it("paints the conversation it hands over to with the coming words' room kept", () => {
    feedState.agentAuth = known(NOT_SIGNED_IN);
    feedState.viewer = ADA;
    feedState.threads = [shell("thread-main", "2026-09-29T20:00:00.000Z")];
    markMateHandedOver(ENVIRONMENT_ID);
    const html = render(ASKED);
    expect(phrases(html)[0]?.place).toBe("past");
    expect(headline(html)).toBe(
      "Fen will stand up development on Acme Docs after you authorize your agent.",
    );
  });
});
