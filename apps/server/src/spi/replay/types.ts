/**
 * SPI replay fixture types.
 *
 * A fixture is a JSONL file (`<dir>/<name>.jsonl`) of lines in arrival
 * order, plus a sidecar `<dir>/<name>.meta.json`. Two line shapes:
 *
 * - `{"kind":"message","message":<...>}` — a raw wire message the driver
 *   received (a Claude `SDKMessage`, a Codex `{method,params}` notification,
 *   ...). The replay module for that driver feeds it into the driver's
 *   normal message-consumption path.
 * - `{"kind":"control","name":"canUseTool"|"onUserDialog"|...,"args":<...>,"answer":<...>}`
 *   — a callback the driver invoked into owned code mid-stream (Claude's
 *   `canUseTool`/`onUserDialog`). `args` are the callback's own parameters;
 *   `answer` is replay-harness-specific — see the driver's replay module for
 *   the shape it expects.
 *
 * Both line shapes are driver-agnostic at the type level; each replay module
 * owns interpreting its `message`/`args`/`answer` payloads.
 */

export interface FixtureMessageLine {
  readonly kind: "message";
  readonly message: unknown;
}

export interface FixtureControlLine {
  readonly kind: "control";
  readonly name: string;
  readonly args: unknown;
  readonly answer: unknown;
}

export type FixtureLine = FixtureMessageLine | FixtureControlLine;

export interface FixtureMeta {
  readonly driver: string;
  readonly cliVersion?: string;
  readonly model?: string;
  readonly capturedAt?: string;
  readonly capturedOn?: string;
  readonly capturedBy?: string;
  readonly notes?: string;
  /**
   * True when this fixture was hand-authored to prove a code path rather
   * than recorded from a real driver run (e.g. a minimal control-line
   * fixture built before the recording slice landed real captures).
   */
  readonly synthetic?: boolean;
}

export interface Fixture {
  readonly name: string;
  readonly dir: string;
  readonly meta: FixtureMeta;
  readonly lines: ReadonlyArray<FixtureLine>;
}
