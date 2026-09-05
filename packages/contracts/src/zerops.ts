/**
 * Zerops feeds — the additive contract slice the Zerops-aware client renders from.
 *
 * **lifecycle** (`ZeropsLifecycle`) — where the agent is, reduced per thread
 * from the `workflow.StateEnvelope` that zcp's workflow-aware tool results
 * carry. One per thread. What exists in the Zerops project is no longer a
 * server feed: the client reads it directly with its own Zerops token and
 * projects it client-side (`packages/client-runtime/src/zerops/topology.ts`).
 *
 * Nothing here mutates: the client renders state, the agent mutates through MCP.
 *
 * ## Why the enum-shaped fields are plain strings
 *
 * `ZeropsStateEnvelope` mirrors a Go type owned by another repo (`zcp`,
 * `internal/workflow/envelope.go`) that gains values independently of this
 * build — `phase` gained `launch-production-active` that way. A
 * `Schema.Literals` union would make the *whole* envelope undecodable the first
 * time zcp ships a new value, taking the strip down over a field the client
 * could have ignored. So every open vocabulary decodes as a string and the
 * known values ship beside it as a `KNOWN_*` const array for the client to
 * switch on with a default branch. Same reasoning for the timestamps zcp
 * produces: they stay strings (`IsoDateTime`), while timestamps this server
 * mints are `Schema.DateTimeUtc`.
 */
import * as Schema from "effect/Schema";

import {
  ForwardCompatibleArray,
  IsoDateTime,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ServerProviderAuthStatus } from "./server.ts";

// ---------------------------------------------------------------------------
// StateEnvelope mirror — zcp `internal/workflow/envelope.go`
// ---------------------------------------------------------------------------

export const KNOWN_ZEROPS_PHASES = [
  "idle",
  "bootstrap-active",
  "develop-active",
  "develop-closed-auto",
  "strategy-setup",
  "export-active",
  "launch-production-active",
] as const;

export const KNOWN_ZEROPS_IDLE_SCENARIOS = [
  "empty",
  "bootstrapped",
  "adopt",
  "incomplete",
] as const;

export const KNOWN_ZEROPS_BOOTSTRAP_ROUTES = ["recipe", "classic", "adopt", "resume"] as const;

export const ZeropsEnvelopeProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
});
export type ZeropsEnvelopeProject = typeof ZeropsEnvelopeProject.Type;

export const ZeropsEnvelopeSelfService = Schema.Struct({
  hostname: Schema.String,
});
export type ZeropsEnvelopeSelfService = typeof ZeropsEnvelopeSelfService.Type;

/** One service's point-in-time lifecycle state — `workflow.ServiceSnapshot`. */
export const ZeropsServiceSnapshot = Schema.Struct({
  hostname: Schema.String,
  typeVersion: Schema.String,
  runtimeClass: Schema.String,
  status: Schema.String,
  bootstrapped: Schema.Boolean,
  deployed: Schema.optional(Schema.Boolean),
  resumable: Schema.optional(Schema.Boolean),
  mode: Schema.optional(Schema.String),
  closeDeployMode: Schema.optional(Schema.String),
  gitPushState: Schema.optional(Schema.String),
  buildIntegration: Schema.optional(Schema.String),
  remoteUrl: Schema.optional(Schema.String),
  feedsProduction: Schema.optional(Schema.Array(Schema.String)),
  stageHostname: Schema.optional(Schema.String),
  setupName: Schema.optional(Schema.String),
  stageSetupName: Schema.optional(Schema.String),
});
export type ZeropsServiceSnapshot = typeof ZeropsServiceSnapshot.Type;

/** One deploy or verify attempt — `workflow.AttemptInfo`. */
export const ZeropsAttemptInfo = Schema.Struct({
  at: IsoDateTime,
  success: Schema.Boolean,
  iteration: Schema.Number,
  setup: Schema.optional(Schema.String),
  strategy: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  failureClass: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
});
export type ZeropsAttemptInfo = typeof ZeropsAttemptInfo.Type;

export const ZeropsWorkSession = Schema.Struct({
  intent: Schema.String,
  services: Schema.Array(Schema.String),
  /** hostname → `required | deferred | out-of-scope`. Absent entry means required. */
  roles: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  createdAt: IsoDateTime,
  closedAt: Schema.optional(IsoDateTime),
  closeReason: Schema.optional(Schema.String),
  deploys: Schema.optional(Schema.Record(Schema.String, Schema.Array(ZeropsAttemptInfo))),
  verifies: Schema.optional(Schema.Record(Schema.String, Schema.Array(ZeropsAttemptInfo))),
});
export type ZeropsWorkSession = typeof ZeropsWorkSession.Type;

export const ZeropsRecipeMatch = Schema.Struct({
  slug: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  confidence: Schema.Number,
  importYaml: Schema.optional(Schema.String),
  mode: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
  guiSlug: Schema.optional(Schema.String),
});
export type ZeropsRecipeMatch = typeof ZeropsRecipeMatch.Type;

export const ZeropsBootstrapSession = Schema.Struct({
  route: Schema.String,
  step: Schema.optional(Schema.String),
  intent: Schema.optional(Schema.String),
  recipeMatch: Schema.optional(ZeropsRecipeMatch),
  closed: Schema.optional(Schema.Boolean),
});
export type ZeropsBootstrapSession = typeof ZeropsBootstrapSession.Type;

/**
 * `workflow.StateEnvelope` — the state zcp computes once per workflow-aware
 * tool result and ships inside the result text as a fenced `json zcp-envelope`
 * block. Contract: zcp `docs/spec-mate.md` §1.
 *
 * `services` decodes through {@link ForwardCompatibleArray}: a snapshot this
 * build cannot decode is dropped rather than failing the envelope, so one
 * unfamiliar service never blanks the whole strip.
 */
export const ZeropsStateEnvelope = Schema.Struct({
  phase: Schema.String,
  environment: Schema.String,
  idleScenario: Schema.optional(Schema.String),
  exportStatus: Schema.optional(Schema.String),
  selfService: Schema.optional(ZeropsEnvelopeSelfService),
  project: ZeropsEnvelopeProject,
  services: ForwardCompatibleArray(ZeropsServiceSnapshot),
  workSession: Schema.optional(ZeropsWorkSession),
  bootstrap: Schema.optional(ZeropsBootstrapSession),
  generated: IsoDateTime,
});
export type ZeropsStateEnvelope = typeof ZeropsStateEnvelope.Type;

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export const ZeropsToolStatus = Schema.Literals(["inProgress", "completed", "failed"]);
export type ZeropsToolStatus = typeof ZeropsToolStatus.Type;

/**
 * One `zerops_*` tool call, for the strip's "last action".
 *
 * Recorded for EVERY Zerops tool, whether or not it carries an envelope. The
 * envelope says where the agent IS; it cannot say what is happening right now —
 * a tool still running has no result yet, and a failed one carries no envelope
 * by design — and the strip still has to be able to read "deploying".
 * This is a log, not a state machine: the envelope stays the state.
 */
export const ZeropsRecentTool = Schema.Struct({
  toolName: TrimmedNonEmptyString,
  status: ZeropsToolStatus,
  at: Schema.DateTimeUtc,
  /**
   * The runtime item this call belongs to. Lets a client link a strip entry to
   * its row in the thread timeline, and is what turns a started-then-completed
   * tool into one entry that changes status rather than two rows.
   */
  itemId: Schema.optional(Schema.String),
});
export type ZeropsRecentTool = typeof ZeropsRecentTool.Type;

/** How many `recentTools` entries a thread keeps. */
export const ZEROPS_RECENT_TOOLS_LIMIT = 8;

export const ZeropsLifecycle = Schema.Struct({
  threadId: ThreadId,
  /** Absent until this thread's agent has run a tool that carries an envelope. */
  envelope: Schema.optional(ZeropsStateEnvelope),
  recentTools: Schema.Array(ZeropsRecentTool),
  /** Absent when nothing has been recorded for this thread yet. */
  updatedAt: Schema.optional(Schema.DateTimeUtc),
});
export type ZeropsLifecycle = typeof ZeropsLifecycle.Type;

// ---------------------------------------------------------------------------
// RPC payloads
// ---------------------------------------------------------------------------

export const ZeropsLifecycleGetInput = Schema.Struct({
  threadId: ThreadId,
});
export type ZeropsLifecycleGetInput = typeof ZeropsLifecycleGetInput.Type;

// ---------------------------------------------------------------------------
// Agent authorization
// ---------------------------------------------------------------------------

/**
 * Agents with a live-verified local credential probe
 * (docs/spec-welcome-mode.md §3 W-STATE) — the only two this feed reports on.
 * An agent without a verified probe would render every row "not-authorized"
 * regardless of platform truth, which is worse than not offering it. A
 * closed union, unlike {@link ZeropsAdoptionState}: this is a fixed pair, not
 * an open vocabulary zcp grows independently.
 */
export const ZeropsAgentId = Schema.Literals(["claude-code", "codex"]);
export type ZeropsAgentId = typeof ZeropsAgentId.Type;

/**
 * The §3 W-STATE matrix, five values, mirrored verbatim from
 * `vscode-bootstrap-welcome.js`'s `computeAgentState` (docs/spec-welcome-mode.md
 * §3): the platform flag and the local credential artifact are two
 * INDEPENDENT inputs that compose a matrix, never a boolean union. Unlike
 * {@link ZeropsAdoptionState}/the envelope's `phase`, this value is computed
 * by mate itself (never received verbatim from zcp on the wire), so a closed
 * union is safe here.
 */
export const ZeropsAgentAuthState = Schema.Literals([
  "authorized-token",
  "authorized",
  "reconnect",
  "local-only",
  "not-authorized",
]);
export type ZeropsAgentAuthState = typeof ZeropsAgentAuthState.Type;

/**
 * Where a server-driven login attempt currently stands, reduced from the
 * agent CLI's own terminal output (S7 follow-up F8 — `ZeropsAgentLogin`,
 * ported from the Zerops GUI's `zcp-agent-auth-dialog` walker):
 *
 * - `starting` — the terminal is being opened; the login command has not
 *   been written yet.
 * - `menu` — the command is running; the server is auto-navigating whatever
 *   the CLI prints (a Y/N confirmation, a login-method picker, or any other
 *   unrecognized screen) the same way a user pressing Enter through it
 *   would, until a URL, a "paste code" prompt, success, or failure appears.
 * - `awaiting-browser` — an auth URL (and, for Codex, its device code) was
 *   found; the user needs to open it (or copy the code) in their own
 *   browser.
 * - `awaiting-code` — the CLI is now showing a "paste code here" prompt
 *   (Claude only); the user pastes the code directly into the terminal
 *   pane — it never crosses the wire as a field.
 * - `succeeded` / `failed` / `cancelled` — terminal states.
 */
export const ZeropsAgentLoginPhase = Schema.Literals([
  "starting",
  "menu",
  "awaiting-browser",
  "awaiting-code",
  "succeeded",
  "failed",
  "cancelled",
]);
export type ZeropsAgentLoginPhase = typeof ZeropsAgentLoginPhase.Type;

export const ZeropsAgentLoginState = Schema.Struct({
  phase: ZeropsAgentLoginPhase,
  /** The auth URL, once the terminal has printed a complete one. */
  url: Schema.optional(Schema.String),
  /** The device code (Codex's device-auth flow only). */
  code: Schema.optional(Schema.String),
  /** A human-readable detail for `failed` — never a credential value. */
  message: Schema.optional(Schema.String),
  /** The dedicated terminal this login session runs in (`terminal.attach`/`terminal.write` target). */
  terminalId: Schema.String,
  startedAt: Schema.DateTimeUtc,
});
export type ZeropsAgentLoginState = typeof ZeropsAgentLoginState.Type;

export const ZeropsAgentAuth = Schema.Struct({
  agentId: ZeropsAgentId,
  /** Whether the local credential artifact exists. Presence only — its contents are never read. */
  credPresent: Schema.Boolean,
  /** `ZCP_AGENT_OAUTH_<SUFFIX>=true` in the zembed env store. */
  flagOAuth: Schema.Boolean,
  /** `ZCP_AGENT_TOKEN_<SUFFIX>` present (any value) in the zembed env store. */
  flagToken: Schema.Boolean,
  /**
   * The provider's own authentication probe for this agent's default
   * instance ({@link ServerProviderAuth.status}), refreshed (coalesced,
   * targeted to this one provider) whenever the credential artifact appears
   * or is replaced. `"unknown"` before the first check has run. Presence of
   * the credential FILE is not proof of a working login — a stale or
   * unusable credential can exist on disk — so this is the field that
   * actually gates the `mark-oauth` spawn, never `credPresent` alone.
   */
  providerAuth: ServerProviderAuthStatus,
  state: ZeropsAgentAuthState,
  /** A server-driven login attempt in progress (or just finished) for this agent — see {@link ZeropsAgentLoginState}. Absent when none has ever run this process's lifetime. */
  login: Schema.optional(ZeropsAgentLoginState),
  /**
   * Which Zerops user signed this agent in, recorded when a server-driven
   * login succeeded. The subject is the Zerops user id — the same value the
   * door puts on the session grant.
   *
   * This exists because an agent CLI's credential is a *personal* one. Under
   * Anthropic's consumer terms a subscription login is yours to use on your
   * own machines and nobody else's, so a project member who did not authorize
   * this container must be told whose identity they are about to spend, not
   * silently handed it.
   *
   * **Absent means unknown, never "someone else's".** A credential can predate
   * this field, or have been placed in the container by other means; the
   * client must say "not recorded", not accuse. Nothing here reads the
   * credential itself — presence and provenance only.
   */
  authorizedBy: Schema.optional(
    Schema.Struct({
      subject: Schema.String,
      at: Schema.DateTimeUtc,
    }),
  ),
});
export type ZeropsAgentAuth = typeof ZeropsAgentAuth.Type;

/**
 * `available: false` means this is not a Zerops environment — the feed is off
 * and that is not an error.
 */
export const ZeropsAgentAuthSnapshot = Schema.Struct({
  available: Schema.Boolean,
  /** Why the feed is unavailable. Absent when it is available. */
  reason: Schema.optional(Schema.String),
  agents: Schema.Array(ZeropsAgentAuth),
});
export type ZeropsAgentAuthSnapshot = typeof ZeropsAgentAuthSnapshot.Type;

// ---------------------------------------------------------------------------
// Agent login — S7 follow-up F8
// ---------------------------------------------------------------------------

/**
 * The command each agent CLI runs to start an interactive login, typed into
 * its dedicated terminal by the SERVER (`ZeropsAgentLogin`, ported from the
 * Zerops GUI's `zcp-agent-auth-dialog` walker) — never by the client. Moved
 * here (off the web-only `agentLogin.ts` this replaces) because the value
 * now belongs to whichever side actually runs the command.
 */
export const ZEROPS_AGENT_LOGIN_COMMANDS: Readonly<Record<ZeropsAgentId, string>> = {
  "claude-code": "claude /login",
  codex: "codex login --device-auth",
};

export const ZeropsAgentLoginStartInput = Schema.Struct({
  agentId: ZeropsAgentId,
  threadId: ThreadId,
});
export type ZeropsAgentLoginStartInput = typeof ZeropsAgentLoginStartInput.Type;

export const ZeropsAgentLoginStartResult = Schema.Struct({
  terminalId: Schema.String,
});
export type ZeropsAgentLoginStartResult = typeof ZeropsAgentLoginStartResult.Type;

export const ZeropsAgentLoginCancelInput = Schema.Struct({
  agentId: ZeropsAgentId,
});
export type ZeropsAgentLoginCancelInput = typeof ZeropsAgentLoginCancelInput.Type;

export const ZeropsAgentLoginErrorReason = Schema.Literals([
  /** This environment does not offer a server-driven login (not a Zerops environment). */
  "unavailable",
]);
export type ZeropsAgentLoginErrorReason = typeof ZeropsAgentLoginErrorReason.Type;

/** Mirrors `ExecError` (`exec.ts`) — this RPC performs a real action, so "not a Zerops environment" is a failure, not a feed value. */
export class ZeropsAgentLoginError extends Schema.TaggedErrorClass<ZeropsAgentLoginError>()(
  "ZeropsAgentLoginError",
  {
    reason: ZeropsAgentLoginErrorReason,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return this.detail;
  }
}

// ---------------------------------------------------------------------------
// Browser surface (S8b) — the live view of the agent-browser daemon
// ---------------------------------------------------------------------------

/**
 * `no-browser` — the daemon's published port file is absent or unparsable
 * (no session, or the container restarted). `connecting` — a port was read
 * and a socket to the daemon is being opened/re-opened. `live` — frames are
 * flowing. Never a fourth "error" value: a socket failure re-reads the port
 * and retries with backoff, landing back on one of these three (spec-mate.md
 * §0 rule 3 — zcp sets nothing here; the port file is the only signal).
 */
export const ZeropsBrowserStreamStatus = Schema.Literals(["no-browser", "connecting", "live"]);
export type ZeropsBrowserStreamStatus = typeof ZeropsBrowserStreamStatus.Type;

/**
 * One relayed frame, verbatim — the server never re-encodes the daemon's own
 * JPEG. `width`/`height` are the captured image's own pixel dimensions (for
 * the panel's canvas); `pageScaleFactor` is the page's current zoom level —
 * dividing a click's image-pixel position by it gives the CSS-viewport
 * coordinates CDP's `Input.dispatchMouseEvent` expects (defaults to `1` when
 * absent, i.e. no zoom). `scrollX`/`scrollY` are the page's current scroll
 * offset, carried for display/telemetry only — CDP's own input dispatch is
 * viewport-relative and never needs them added to a click's coordinates.
 */
export const ZeropsBrowserFrame = Schema.Struct({
  type: Schema.Literal("frame"),
  /** Base64 JPEG, relayed as received. */
  data: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  pageScaleFactor: Schema.optional(Schema.Number),
  scrollX: Schema.optional(Schema.Number),
  scrollY: Schema.optional(Schema.Number),
});
export type ZeropsBrowserFrame = typeof ZeropsBrowserFrame.Type;

/**
 * A state transition, published on first subscribe and whenever the relay's
 * connection to the daemon, or the daemon's own reported tab, changes. `url`/
 * `title` ride along once known (the daemon's own `tabs`/`url` messages) so
 * the panel can say what page the agent is looking at without a second read.
 */
export const ZeropsBrowserStateEvent = Schema.Struct({
  type: Schema.Literal("state"),
  status: ZeropsBrowserStreamStatus,
  url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
});
export type ZeropsBrowserStateEvent = typeof ZeropsBrowserStateEvent.Type;

/** The one stream `subscribeZeropsBrowserStream` publishes: state transitions interleaved with frames. */
export const ZeropsBrowserStreamEvent = Schema.Union([ZeropsBrowserFrame, ZeropsBrowserStateEvent]);
export type ZeropsBrowserStreamEvent = typeof ZeropsBrowserStreamEvent.Type;

/**
 * A pointer event from the panel's canvas, already mapped to device pixels
 * by the client (`packages/client-runtime/src/zerops/browserStream.ts`).
 * `eventType`/`button`/`clickCount` mirror CDP's `Input.dispatchMouseEvent`
 * vocabulary verbatim (agent-browser's own streaming reference,
 * `/usr/lib/node_modules/agent-browser/skill-data/core/references/streaming.md`
 * on the rig) — the relay forwards these fields as-is, no translation. A
 * canvas click is two events, `mousePressed` then `mouseReleased`, both
 * `clickCount: 1`.
 */
export const ZeropsBrowserMouseInput = Schema.Struct({
  kind: Schema.Literal("mouse"),
  eventType: Schema.Literals(["mouseMoved", "mousePressed", "mouseReleased"]),
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optional(Schema.Literals(["left", "middle", "right", "none"])),
  clickCount: Schema.optional(Schema.Number),
});
export type ZeropsBrowserMouseInput = typeof ZeropsBrowserMouseInput.Type;

/**
 * A keyboard event from the panel, CDP vocabulary (see
 * {@link ZeropsBrowserMouseInput}'s doc comment). `text` carries a printable
 * character (composition-safe); `key` carries a named key (`Enter`,
 * `Backspace`, `ArrowLeft`, ...).
 */
export const ZeropsBrowserKeyboardInput = Schema.Struct({
  kind: Schema.Literal("keyboard"),
  eventType: Schema.Literals(["keyDown", "keyUp", "char"]),
  key: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});
export type ZeropsBrowserKeyboardInput = typeof ZeropsBrowserKeyboardInput.Type;

/** `zeropsBrowserInput`'s RPC payload — one input event, client → daemon. */
export const ZeropsBrowserInput = Schema.Union([
  ZeropsBrowserMouseInput,
  ZeropsBrowserKeyboardInput,
]);
export type ZeropsBrowserInput = typeof ZeropsBrowserInput.Type;
