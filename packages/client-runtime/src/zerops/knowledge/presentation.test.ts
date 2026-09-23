import { describe, expect, it } from "vite-plus/test";

import type {
  AbsenceEvidence,
  FailureReason,
  Freshness,
  Prerequisite,
  Shown,
  StaleReason,
  WithheldReason,
} from "./known.ts";
import {
  KNOWN_AFFORDANCE_LABELS,
  knownPresentation,
  type KnowledgeSource,
  type KnownPresentation,
  type KnownSurface,
  type PresentationContext,
} from "./presentation.ts";

const NOW = 100_000;
const CONTEXT: PresentationContext = { nowMs: NOW, updateOffered: false };
const NEGATIVE = "No open pull requests";
const VALUE = "platform-value-7f3a";

const PULL_REQUESTS: KnownSurface<ReadonlyArray<string>> = {
  subject: "pull requests",
  entity: "repository",
  source: "gitea",
  checking: null,
  negative: (value) => (value.length === 0 ? NEGATIVE : null),
};

const known = (
  value: ReadonlyArray<string>,
  freshness: Freshness,
  coverage: "complete" | "partial" = "complete",
): Shown<ReadonlyArray<string>> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: 1_000 },
  coverage,
  freshness,
});

const TIMEOUT: FailureReason = { kind: "timeout", afterMs: 15_000 };

interface CopyRow {
  readonly name: string;
  readonly shown: Shown<ReadonlyArray<string>>;
  readonly surface?: KnownSurface<ReadonlyArray<string>>;
  readonly context?: PresentationContext;
  readonly expected: Partial<KnownPresentation>;
}

/** DESIGN §3.4, one row per line of the rendering table. */
const RENDERING: ReadonlyArray<CopyRow> = [
  {
    name: "unread: a placeholder, nothing for 400 ms, then Checking…",
    shown: { state: "unread", waitingFor: null },
    expected: {
      region: "placeholder",
      message: { text: "Checking…", afterMs: 400, tone: "quiet" },
      affordance: null,
    },
  },
  {
    name: "reading: the region's own checking phrase",
    shown: { state: "reading", sinceMs: 1_000, attempt: 1 },
    surface: { ...PULL_REQUESTS, checking: "Checking what runs here…" },
    expected: {
      region: "placeholder",
      message: { text: "Checking what runs here…", afterMs: 400, tone: "quiet" },
      affordance: null,
    },
  },
  {
    name: "unread(waitingFor gitea-session): Signing in to Gitea…",
    shown: { state: "unread", waitingFor: "gitea-session" },
    expected: {
      region: "placeholder",
      message: { text: "Signing in to Gitea…", afterMs: 0, tone: "quiet" },
      affordance: null,
    },
  },
  {
    name: "unread(waitingFor mate-session): Waiting for this Mate to connect…",
    shown: { state: "unread", waitingFor: "mate-session" },
    expected: {
      region: "placeholder",
      message: { text: "Waiting for this Mate to connect…", afterMs: 0, tone: "quiet" },
      affordance: null,
    },
  },
  {
    name: "failed: a region message that names the cause, and Try again",
    shown: { state: "failed", failure: TIMEOUT, atMs: 1_000, attempt: 1, retryAtMs: 104_000 },
    expected: {
      region: "message",
      message: {
        text: "Couldn't read pull requests. Gitea didn't answer.",
        afterMs: 0,
        tone: "alert",
      },
      affordance: { kind: "retry", label: "Try again" },
      current: false,
    },
  },
  {
    name: "failed(refused): the source's words without an affordance of their own (R-K3)",
    shown: {
      state: "failed",
      failure: {
        kind: "refused",
        code: "incompleteInventory",
        words: "Zerops returned an incomplete project inventory. Try again.",
      },
      atMs: 1_000,
      attempt: 1,
      retryAtMs: 104_000,
    },
    expected: {
      message: {
        text: "Couldn't read pull requests. Zerops returned an incomplete project inventory.",
        afterMs: 0,
        tone: "alert",
      },
      affordance: { kind: "retry", label: "Try again" },
    },
  },
  {
    name: "failed(refused) with nothing but an affordance in its words: the source said no",
    shown: {
      state: "failed",
      failure: { kind: "refused", code: "busy", words: "Try now" },
      atMs: 1_000,
      attempt: 1,
      retryAtMs: 104_000,
    },
    expected: {
      message: { text: "Couldn't read pull requests. Gitea said no.", afterMs: 0, tone: "alert" },
      affordance: { kind: "retry", label: "Try again" },
    },
  },
  {
    name: "failed(unsupported) with an update offered: Update, no retry",
    shown: {
      state: "failed",
      failure: { kind: "unsupported", capability: "deploymentFeed" },
      atMs: 1_000,
      attempt: 1,
      retryAtMs: null,
    },
    surface: { ...PULL_REQUESTS, source: "mate" },
    context: { nowMs: NOW, updateOffered: true },
    expected: {
      region: "message",
      message: {
        text: "This Mate is too old for this. Updating it adds it.",
        afterMs: 0,
        tone: "alert",
      },
      affordance: { kind: "update", label: "Update" },
    },
  },
  {
    name: "failed(unsupported) without an update offered: no affordance",
    shown: {
      state: "failed",
      failure: { kind: "unsupported", capability: "deploymentFeed" },
      atMs: 1_000,
      attempt: 1,
      retryAtMs: null,
    },
    surface: { ...PULL_REQUESTS, source: "mate" },
    expected: {
      region: "message",
      message: {
        text: "This Mate is too old for this. Updating it adds it.",
        afterMs: 0,
        tone: "alert",
      },
      affordance: null,
    },
  },
  {
    name: "known(live): the value, including its domain negative",
    shown: known([], { kind: "live" }),
    expected: {
      region: "value",
      message: null,
      affordance: null,
      current: true,
      negative: NEGATIVE,
    },
  },
  {
    name: "known(settled): the value, current",
    shown: known(["#1"], { kind: "settled" }),
    expected: { region: "value", message: null, affordance: null, current: true, negative: null },
  },
  {
    name: "known(revalidating): the value unchanged, a muted Updating… after 1 s, verbs allowed",
    shown: known(["#1"], { kind: "revalidating", sinceMs: 99_000 }),
    expected: {
      region: "value",
      message: { text: "Updating…", afterMs: 1_000, tone: "quiet" },
      affordance: null,
      current: true,
    },
  },
  {
    name: "known(paused): the value marked not current",
    shown: known(["#1"], { kind: "paused", by: "background" }),
    expected: {
      region: "value",
      message: {
        text: "Paused while this tab is in the background.",
        afterMs: 0,
        tone: "notice",
      },
      affordance: null,
      current: false,
    },
  },
  {
    name: "known(stale(revalidation-failed)): a quiet marker with the countdown, and Try now",
    shown: known(["#1"], {
      kind: "stale",
      reason: { kind: "revalidation-failed", failure: TIMEOUT, attempt: 2, retryAtMs: 108_000 },
      sinceMs: 95_000,
    }),
    expected: {
      region: "value",
      message: {
        text: "Not up to date. Gitea didn't answer. Trying again in 8 s.",
        afterMs: 0,
        tone: "notice",
      },
      affordance: { kind: "retry-now", label: "Try now" },
      current: false,
    },
  },
  {
    name: "known(stale(source-recovering)): Reconnecting…, and Try now",
    shown: known(["#1"], {
      kind: "stale",
      reason: { kind: "source-recovering", retryAtMs: 104_000 },
      sinceMs: 95_000,
    }),
    expected: {
      region: "value",
      message: { text: "Reconnecting…", afterMs: 0, tone: "notice" },
      affordance: { kind: "retry-now", label: "Try now" },
      current: false,
    },
  },
  {
    name: "known(partial): the known members, Still reading…, never a negative",
    shown: known([], { kind: "live" }, "partial"),
    expected: {
      region: "value",
      message: { text: "Still reading…", afterMs: 0, tone: "quiet" },
      affordance: null,
      current: true,
      negative: null,
    },
  },
  {
    name: "gone: the authoritative negative in the AL-09 wording, and Go to projects",
    shown: { state: "gone", evidence: "direct-not-found", asOf: { ordinal: 2, atMs: 2_000 } },
    surface: { ...PULL_REQUESTS, entity: "project", source: "zerops" },
    expected: {
      region: "message",
      message: {
        text: "This project is no longer available. It was deleted, or you no longer have access.",
        afterMs: 0,
        tone: "notice",
      },
      affordance: { kind: "go-to-projects", label: "Go to projects" },
      negative: null,
    },
  },
  {
    name: "withheld(access-lapsed), no cause: a placeholder and one app banner, no region error",
    shown: { state: "withheld", reason: "access-lapsed", cause: null },
    expected: {
      region: "placeholder",
      message: null,
      affordance: null,
      banner: {
        key: "access-lapsed",
        message: { text: "Checking your Zerops access…", afterMs: 0, tone: "quiet" },
        affordance: null,
      },
    },
  },
  {
    name: "withheld(access-lapsed) with a failure cause: the banner names it, Try now renews",
    shown: {
      state: "withheld",
      reason: "access-lapsed",
      cause: { failure: { kind: "server", status: 503 }, retryAtMs: 112_000 },
    },
    expected: {
      region: "placeholder",
      message: null,
      affordance: null,
      banner: {
        key: "access-lapsed",
        message: {
          text: "Zerops isn't answering. Trying again in 12 s.",
          afterMs: 0,
          tone: "alert",
        },
        affordance: { kind: "renew-access", label: "Try now" },
      },
    },
  },
  {
    name: "withheld(access-unverified): a placeholder in that project's rows only",
    shown: { state: "withheld", reason: "access-unverified", cause: null },
    expected: {
      region: "placeholder",
      message: { text: "Checking your access to this project…", afterMs: 0, tone: "quiet" },
      affordance: null,
      banner: null,
    },
  },
  {
    name: "withheld(access-denied): Your access to this project changed, and Go to projects",
    shown: { state: "withheld", reason: "access-denied", cause: null },
    expected: {
      region: "placeholder",
      message: { text: "Your access to this project changed.", afterMs: 0, tone: "alert" },
      affordance: { kind: "go-to-projects", label: "Go to projects" },
      banner: null,
    },
  },
];

describe("knownPresentation (DESIGN §3.4)", () => {
  it.each(RENDERING)("$name", ({ shown, surface, context, expected }) => {
    expect(knownPresentation(shown, surface ?? PULL_REQUESTS, context ?? CONTEXT)).toMatchObject(
      expected,
    );
  });
});

// ── the vector: every Shown state × every surface × every context ──────────────────────────────

const FAILURES: ReadonlyArray<FailureReason> = [
  { kind: "offline" },
  TIMEOUT,
  { kind: "transport", detail: "ECONNRESET" },
  { kind: "throttled", retryAfterMs: 5_000 },
  { kind: "throttled", retryAfterMs: null },
  { kind: "server", status: 502 },
  { kind: "unauthorized" },
  { kind: "refused", code: "projectNotFound", words: "The project does not exist" },
  {
    kind: "refused",
    code: "incompleteInventory",
    words: "Zerops returned an incomplete project inventory. Try again.",
  },
  { kind: "refused", code: "busy", words: "Try now" },
  { kind: "malformed", detail: "unexpected token" },
  { kind: "unsupported", capability: "deploymentFeed" },
];
const RETRY_TIMES: ReadonlyArray<number | null> = [null, NOW + 4_500, NOW - 1];
const PREREQUISITES: ReadonlyArray<Prerequisite | null> = [
  null,
  "zerops-session",
  "access-grant",
  "gitea-session",
  "mate-session",
  "presence",
  "visible",
  "online",
];
const EVIDENCE: ReadonlyArray<AbsenceEvidence> = [
  "direct-not-found",
  "direct-forbidden",
  "complete-scope-omits-verified",
  "authoritative-removal",
  "removed-by-user",
];
const WITHHELD: ReadonlyArray<WithheldReason> = [
  "access-lapsed",
  "access-unverified",
  "access-denied",
];

const staleReasons: ReadonlyArray<StaleReason> = [
  ...RETRY_TIMES.map((retryAtMs): StaleReason => ({ kind: "source-recovering", retryAtMs })),
  ...FAILURES.flatMap((failure) =>
    RETRY_TIMES.map((retryAtMs): StaleReason => ({
      kind: "revalidation-failed",
      failure,
      attempt: 3,
      retryAtMs,
    })),
  ),
  { kind: "invalidated" },
  { kind: "superseded", by: "env-2" },
];
const freshnesses: ReadonlyArray<Freshness> = [
  { kind: "live" },
  { kind: "settled" },
  { kind: "revalidating", sinceMs: NOW - 2_000 },
  { kind: "paused", by: "background" },
  { kind: "paused", by: "offline" },
  ...staleReasons.map((reason): Freshness => ({ kind: "stale", reason, sinceMs: NOW - 9_000 })),
];

const everyShown: ReadonlyArray<Shown<ReadonlyArray<string>>> = [
  ...PREREQUISITES.map((waitingFor): Shown<ReadonlyArray<string>> => ({
    state: "unread",
    waitingFor,
  })),
  { state: "reading", sinceMs: NOW - 500, attempt: 2 },
  ...FAILURES.flatMap((failure) =>
    RETRY_TIMES.map((retryAtMs): Shown<ReadonlyArray<string>> => ({
      state: "failed",
      failure,
      atMs: NOW - 1_000,
      attempt: 2,
      retryAtMs,
    })),
  ),
  ...[[], [VALUE]].flatMap((value) =>
    (["complete", "partial"] as const).flatMap((coverage) =>
      freshnesses.map((freshness) => known(value, freshness, coverage)),
    ),
  ),
  ...EVIDENCE.map((evidence): Shown<ReadonlyArray<string>> => ({
    state: "gone",
    evidence,
    asOf: { ordinal: 3, atMs: 3_000 },
  })),
  ...WITHHELD.flatMap((reason) =>
    [
      null,
      ...FAILURES.flatMap((failure) => RETRY_TIMES.map((retryAtMs) => ({ failure, retryAtMs }))),
    ].map((cause): Shown<ReadonlyArray<string>> => ({ state: "withheld", reason, cause })),
  ),
];

const SOURCES: ReadonlyArray<KnowledgeSource> = ["zerops", "gitea", "mate"];
const everySurface: ReadonlyArray<KnownSurface<ReadonlyArray<string>>> = SOURCES.flatMap(
  (source) => [
    { ...PULL_REQUESTS, source },
    { ...PULL_REQUESTS, source, checking: "Checking what runs here…" },
    { ...PULL_REQUESTS, source, negative: null },
  ],
);
const everyContext: ReadonlyArray<PresentationContext> = [
  CONTEXT,
  { nowMs: NOW, updateOffered: true },
];

const everyOutput = everyShown.flatMap((shown) =>
  everySurface.flatMap((surface) =>
    everyContext.map((context) => ({
      shown,
      surface,
      context,
      output: knownPresentation(shown, surface, context),
    })),
  ),
);

/** Every message the output carries, with the affordance that goes with it. */
const alertsOf = (output: KnownPresentation) => [
  { message: output.message, affordance: output.affordance },
  ...(output.banner === null
    ? []
    : [{ message: output.banner.message, affordance: output.banner.affordance }]),
];

const occurrences = (text: string, phrase: string): number =>
  text.toLowerCase().split(phrase.toLowerCase()).length - 1;

describe("knownPresentation over every Shown state (the vector)", () => {
  it("covers a full cross product", () => {
    expect(everyOutput.length).toBeGreaterThan(2_000);
  });

  it("each alert contains its affordance exactly once", () => {
    const offenders = everyOutput.flatMap(({ shown, surface, context, output }) =>
      alertsOf(output).flatMap(({ message, affordance }) => {
        const text = message?.text ?? "";
        const rendered = affordance === null ? text : `${text} ${affordance.label}`;
        const doubled = KNOWN_AFFORDANCE_LABELS.filter(
          (label) => occurrences(rendered, label) > (label === affordance?.label ? 1 : 0),
        );
        return doubled.length === 0 ? [] : [{ shown, surface: surface.source, context, rendered }];
      }),
    );
    expect(offenders.slice(0, 3)).toEqual([]);
  });

  it("negative copy comes only from a complete known value (R-K1, M5)", () => {
    for (const { shown, output } of everyOutput) {
      if (output.negative !== null) {
        expect(shown.state === "known" && shown.coverage === "complete").toBe(true);
      }
      for (const { message } of alertsOf(output)) {
        expect(message?.text ?? "").not.toContain(NEGATIVE);
      }
    }
  });

  it("withheld shows no platform text and no value", () => {
    for (const { shown, output } of everyOutput) {
      if (shown.state !== "withheld") continue;
      expect(output.region).toBe("placeholder");
      expect(output.negative).toBeNull();
      expect(output.current).toBe(false);
      expect(JSON.stringify(output)).not.toContain(VALUE);
    }
  });

  it("an absence message comes only from gone, a read failure only from failed", () => {
    for (const { shown, output } of everyOutput) {
      for (const { message } of alertsOf(output)) {
        const text = message?.text ?? "";
        if (text.includes("no longer available")) expect(shown.state).toBe("gone");
        if (text.startsWith("Couldn't read")) expect(shown.state).toBe("failed");
      }
    }
  });

  it("an unsupported failure never offers a retry and offers Update only when one exists", () => {
    for (const { shown, context, output } of everyOutput) {
      if (shown.state !== "failed" || shown.failure.kind !== "unsupported") continue;
      expect(output.affordance).toEqual(
        context.updateOffered ? { kind: "update", label: "Update" } : null,
      );
    }
  });

  it("a countdown appears only when a retry time is known", () => {
    for (const { output } of everyOutput) {
      for (const { message } of alertsOf(output)) {
        const text = message?.text ?? "";
        if (text.includes("Trying again in")) expect(text).toMatch(/Trying again in \d+ s\./);
      }
    }
    const noRetry = knownPresentation(
      known(["#1"], {
        kind: "stale",
        reason: { kind: "revalidation-failed", failure: TIMEOUT, attempt: 1, retryAtMs: null },
        sinceMs: NOW,
      }),
      PULL_REQUESTS,
      CONTEXT,
    );
    expect(noRetry.message?.text).toBe("Not up to date. Gitea didn't answer.");
  });

  it("uses the glossary: never 'environment' in user-facing copy", () => {
    for (const { output } of everyOutput) {
      for (const { message } of alertsOf(output)) {
        expect(message?.text.toLowerCase() ?? "").not.toContain("environment");
      }
    }
  });

  it("only a current value lets currency-dependent verbs run", () => {
    for (const { shown, output } of everyOutput) {
      const current =
        shown.state === "known" &&
        (shown.freshness.kind === "live" ||
          shown.freshness.kind === "settled" ||
          shown.freshness.kind === "revalidating");
      expect(output.current).toBe(current);
      if (shown.state === "known" && !current) expect(output.message).not.toBeNull();
    }
  });
});
