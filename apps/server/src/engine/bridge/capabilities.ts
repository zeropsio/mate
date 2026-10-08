/**
 * The six-driver matrix as data (`orch-rewrite/round2/drivers.md` §1). Each
 * row is what the adapter does today, unchanged; a driver change that turns a
 * bridge inference into a driver fact flips its row here.
 */
import type { BridgeDriver, DriverCapabilities } from "./spi3.ts";

const ACP_HOLDS_THE_TURN = {
  sendReturns: "on-turn-end",
  // The adapters carry steer code, but each send awaits the whole prompt and
  // ProviderService holds a per-thread lane around it: a follow-up waits for
  // the turn's end and opens a turn of its own.
  steer: "none",
  selfTurns: false,
  closedSendUndelivered: false,
  usage: { context: false, spend: false },
  compaction: { reported: false, automatic: "unknown" },
  responses: "none",
  continuation: "prompted",
  // apply*AcpModelSelection on every send.
  modelOptions: "per-turn",
} as const;

export const DRIVER_CAPABILITIES: Readonly<Record<BridgeDriver, DriverCapabilities>> = {
  claudeAgent: {
    sendReturns: "on-accept",
    steer: "native",
    // interruptTurn closes the session: the CLI, every helper and shell die.
    interrupt: { confirmedByAgent: false, closesSession: true },
    crashTerminal: "driver",
    selfTurns: true,
    closedSendUndelivered: true,
    usageLimit: { typed: true, parksTurn: true, resetTime: true },
    usage: { context: true, spend: true },
    backgroundWork: "full",
    questions: "structured",
    compaction: { reported: true, automatic: "reported" },
    responses: "tool-calls",
    resume: "session-id",
    continuation: "prompted",
    // Effort through applyFlagSettings on the next send; fast mode and thinking need a session.
    modelOptions: "adapter",
  },
  codex: {
    sendReturns: "on-accept",
    // A mid-turn turn/start is queued by Codex as a new turn; turn/steer is unwired.
    steer: "driver-queue",
    interrupt: { confirmedByAgent: true, closesSession: false },
    // An app-server exit gives session.exited and no turn end.
    crashTerminal: "bridge",
    selfTurns: false,
    closedSendUndelivered: false,
    usageLimit: { typed: true, parksTurn: false, resetTime: false },
    usage: { context: true, spend: false },
    // Child agents are reported, but never their end.
    backgroundWork: "partial",
    questions: "structured",
    compaction: { reported: true, automatic: "reported" },
    responses: "none",
    resume: "thread-resume",
    // Resume keeps an interrupted turn's state, so an empty native turn can go on.
    continuation: "native",
    // reasoningEffort goes with each turn/start.
    modelOptions: "per-turn",
  },
  cursor: {
    ...ACP_HOLDS_THE_TURN,
    // A local cancel: the prompt resolves as a synthetic `cancelled`.
    interrupt: { confirmedByAgent: false, closesSession: false },
    crashTerminal: "driver",
    usageLimit: { typed: false, parksTurn: false, resetTime: false },
    backgroundWork: "none",
    questions: "structured",
    resume: "acp-load",
  },
  grok: {
    ...ACP_HOLDS_THE_TURN,
    // The adapter ends the turn itself; later events of that turn are dropped.
    interrupt: { confirmedByAgent: false, closesSession: false },
    crashTerminal: "driver",
    usageLimit: { typed: true, parksTurn: false, resetTime: false },
    // Tasks seen through tool results; an end only when its result is seen.
    backgroundWork: "partial",
    questions: "structured",
    resume: "acp-load",
  },
  antigravity: {
    ...ACP_HOLDS_THE_TURN,
    // Waits for the agent's answer to the cancel (killed after 15 s).
    interrupt: { confirmedByAgent: true, closesSession: false },
    // Either order: its connection's end can stop the session before the
    // prompt's failure (AG:440-462), leaving the end to the bridge, or the
    // failing prompt ends the turn first (the mock agent's crash, measured).
    crashTerminal: "bridge",
    usageLimit: { typed: false, parksTurn: false, resetTime: false },
    // Commands still open at the turn's end are promoted to tasks.
    backgroundWork: "partial",
    questions: "options-only",
    resume: "acp-resume",
  },
  opencode: {
    sendReturns: "on-accept",
    steer: "native",
    // session.abort, acknowledged by a MessageAbortedError.
    interrupt: { confirmedByAgent: true, closesSession: false },
    // A server exit gives runtime.error(process_exit) and session.exited, no turn end.
    crashTerminal: "bridge",
    selfTurns: false,
    closedSendUndelivered: false,
    usageLimit: { typed: true, parksTurn: false, resetTime: false },
    usage: { context: false, spend: true },
    backgroundWork: "none",
    questions: "structured",
    compaction: { reported: true, automatic: "reported" },
    responses: "tool-calls",
    resume: "session-get",
    continuation: "prompted",
    // agent and variant are read per prompt.
    modelOptions: "per-turn",
  },
};

export const BRIDGE_DRIVERS: ReadonlyArray<BridgeDriver> = Object.keys(
  DRIVER_CAPABILITIES,
) as ReadonlyArray<BridgeDriver>;

export const isBridgeDriver = (driver: string): driver is BridgeDriver =>
  Object.hasOwn(DRIVER_CAPABILITIES, driver);
