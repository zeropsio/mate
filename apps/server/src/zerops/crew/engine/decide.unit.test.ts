import { BootId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import { AGENT_STOPPED_ITSELF } from "../../../engine/MateEngine.ts";
import {
  CrewWorld,
  OPTIONS,
  OTHER,
  finish,
  home,
  lead,
  newTask,
  reader,
  writer,
} from "./crewDecideFixture.ts";

const OVERFLOW = { kind: "failed", reason: "prompt_too_long", next: null } as const;

const goOn = (w: CrewWorld, handle: string) =>
  w.press({ _tag: "message", handle, text: "Go on.", attachments: [] });

const sessions = (w: CrewWorld, handle: string) =>
  w.controls(handle).filter((tag) => tag === "RotateSession").length;

const DEV = { name: "web", port: 3000, command: "npm run dev", cwd: "." } as const;
const READ = { served: { by: "tree" }, devServer: DEV, workDir: ".crew/backend" } as const;

const claim = (w: CrewWorld) => w.state.claims.appdev?.state ?? "none";

/** A writer at work on its first task, its turn running. */
const workingOnHud = (w: CrewWorld) => {
  w.apply(home(writer("backend")));
  newTask(w, "backend", "HUD");
  w.start("backend");
};

const asksToShow = (w: CrewWorld) =>
  w.tool("backend", { tool: "show-on-dev", reason: "See the HUD" });

/** The crewmate's turn ends and its copy is saved. */
const turnEnds = (w: CrewWorld) => {
  w.end("backend");
  w.checkpoint("backend");
};

const CUT = { kind: "cut-by-restart", continuedBy: null } as const;

const restarted = (w: CrewWorld) =>
  w.tell({ _tag: "Recovered", bootId: BootId.make("boot-2") }, { kind: "engine" });

const COMMIT = "c".repeat(40);
const LANDED = { _tag: "landed", commit: COMMIT } as const;

/** A writer working its first task, its card admitted. */
const working = (w: CrewWorld) => {
  w.apply(home(writer("backend")));
  newTask(w, "backend", "First");
  w.start("backend");
};

const run = (w: CrewWorld, landing: "person" | "lead" | "check") => {
  w.press({ _tag: "start", ...OPTIONS, landing }, OTHER);
  w.quiet();
};

const LEAD_LANDS = { ...OPTIONS, landing: "lead" } as const;

const asks = (w: CrewWorld, handle: string, question: string) =>
  w.tool(handle, { tool: "report", input: { status: "blocked", summary: "?", question } });

const EVA = "claudeAgent_eva";
const EVAS = "Only Eva runs her login.";

/** A crew whose writer runs on Eva's login, with one task on its board. */
const crew = () => {
  const w = new CrewWorld();
  w.apply(home(lead(), writer("backend", { login: EVA, run: "npm run dev" })));
  newTask(w, "backend", "Paginate");
  return w;
};

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | if (moved?.state !== "working") return; → if (moved === undefined) return;
it("CD1: A conversation that outgrows its context rotates at once; the third time the task stops", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.end("reviewer", OVERFLOW, { detail: "overflow" });
  const first = [w.task(1).state, sessions(w, "reviewer")];
  goOn(w, "reviewer");
  w.run("reviewer");
  w.end("reviewer", OVERFLOW, { detail: "overflow" });
  goOn(w, "reviewer");
  w.run("reviewer");
  w.end("reviewer", OVERFLOW, { detail: "overflow" });
  expect([first, w.task(1).state, sessions(w, "reviewer")]).toEqual([["working", 1], "parked", 2]);
});

// witness: apps/server/src/zerops/crew/engine/decide.claims.ts | read.served.by === "tree" ? "serves-tree" : "turn-failed" → read.served.by === "crewmate" ? "serves-tree" : "turn-failed"
it("CD2: Show on dev: request, Allow sends the claim turn, dev serving the copy holds it, Back to my tree releases", () => {
  const w = new CrewWorld();
  workingOnHud(w);
  asksToShow(w);
  const states = [claim(w)];
  turnEnds(w);
  w.press({ _tag: "claimGrant", host: "appdev" });
  w.settle("crew.claim.read", "appdev", READ);
  states.push(claim(w));
  w.run("backend");
  turnEnds(w);
  w.settle("crew.claim.read", "appdev", {
    ...READ,
    served: { by: "crewmate", handle: "backend" },
  });
  states.push(claim(w));
  w.press({ _tag: "claimRelease", host: "appdev" });
  states.push(claim(w));
  w.run("backend");
  turnEnds(w);
  w.settle("crew.claim.read", "appdev", READ);
  states.push(claim(w));
  expect([states, w.turns("backend")]).toEqual([
    ["requested", "starting", "held", "releasing", "none"],
    ["task", "claim-start", "claim-release"],
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.claims.ts | workDir: read.workDir, grantWaiting: true → workDir: read.workDir, grantWaiting: b.member(claim.handle).active === null
it("CD3: Allow pressed while the crewmate's turn runs is kept and sent when the turn ends", () => {
  const w = new CrewWorld();
  workingOnHud(w);
  asksToShow(w);
  w.press({ _tag: "claimGrant", host: "appdev" });
  w.settle("crew.claim.read", "appdev", READ);
  const kept = [claim(w), w.state.claims.appdev?.grantWaiting, w.turns("backend")];
  turnEnds(w);
  expect([kept, claim(w), w.turns("backend")]).toEqual([
    ["requested", true, ["task"]],
    "starting",
    ["task", "claim-start"],
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | end.reason === AGENT_STOPPED_ITSELF && event.detail === undefined → end.reason === AGENT_STOPPED_ITSELF && event.detail === "provider-error"
it("CD4: A turn its agent stopped on its own is interrupted, not broken: its task stays in its attempt", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.end("reviewer", { kind: "failed", reason: AGENT_STOPPED_ITSELF, next: null });
  const task = w.task(1);
  expect([task.state, task.counters.attempt, task.midway?.ending]).toEqual([
    "working",
    1,
    "interrupted",
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | if (upTo <= cursor) return; → if (upTo < cursor) return;
it("CD5: A turn's end the crew read once is not taken in again when its record is read again", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  w.press({ _tag: "start", ...OPTIONS }, OTHER);
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.end("reviewer");
  const conversation = w.state.members.reviewer!.conversationId;
  const readUpTo = w.state.cursors[conversation];
  w.replay("reviewer");
  expect([w.turns("reviewer"), readUpTo, w.recorded("ObservedUpTo")]).toEqual([
    ["task", "nudge"],
    4,
    2,
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | if (from > cursor + 1) { → if (from > cursor + 2) {
it("CD6: A range that starts past the crew's cursor + 1 is refused, so no event of a record is skipped", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  const conversation = w.state.members.reviewer!.conversationId;
  const upTo = w.state.cursors[conversation]!;
  const decision = w.tell(
    {
      _tag: "Observed",
      conversationId: conversation,
      from: upTo + 2,
      upTo: upTo + 2,
      events: [
        {
          _tag: "RunAdmitted",
          v: 1,
          conversationId: conversation,
          seq: upTo + 2,
          at: 0,
          commandId: "after-a-lost-batch",
          runId: `${conversation}/r/9`,
        },
      ] as never,
    },
    { kind: "engine" },
  );
  expect([decision._tag, w.state.cursors[conversation] === upTo]).toEqual(["Reject", true]);
});

/** A row of a zcp tool call in the Mate's own conversation. */
const mateCall = (
  seq: number,
  tag: "ItemOpened" | "ItemClosed",
  item: number,
  body: Readonly<Record<string, unknown>>,
) => ({
  _tag: tag,
  v: 1,
  conversationId: "mate-thread",
  seq,
  at: 0,
  commandId: "engine",
  runId: "mate-thread/r/1",
  itemId: `mate-thread/r/1/i/${item}`,
  body: { kind: "call", step: "mcp", words: null, endedAt: null, ...body },
});

const deployRow = (seq: number, tag: "ItemOpened" | "ItemClosed", state: string) =>
  mateCall(seq, tag, 1, {
    tool: { name: "mcp__zerops__zerops_deploy", server: "zerops" },
    state,
    shows: { targetService: "appdev" },
  });

const devServerRow = (seq: number, result: Readonly<Record<string, unknown>>) =>
  mateCall(seq, "ItemClosed", seq, {
    tool: { name: "mcp__zerops__zerops_dev_server", server: "zerops" },
    state: "done",
    input: 'mcp__zerops__zerops_dev_server: {"action":"start","hostname":"appdev"}',
    result: { toolName: "zerops_dev_server", resultText: JSON.stringify(result) },
  });

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | if (body.state === "unreturned" || body.state === "stopped") return undefined; → if (body.state === "stopped") return undefined;
it("CD37: A zerops_deploy call a restart cut off is no end of the deploy, so its host stays frozen", () => {
  const w = new CrewWorld();
  w.apply(home(writer("backend")));
  w.observe("mate-thread", [deployRow(1, "ItemOpened", "running")] as never);
  w.observe("mate-thread", [deployRow(2, "ItemClosed", "unreturned")] as never);
  expect([w.state.hosts.appdev?.frozenSince != null, w.pending("crew.recover", "appdev")]).toEqual([
    true,
    undefined,
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | result.migratedToSupervisor !== true → result.migratedToSupervisor !== "true"
it("CD38: A dev server start that moved the dev service onto the supervisor is a deploy of that host: frozen, then recovered", () => {
  const w = new CrewWorld();
  w.apply(home(writer("backend")));
  w.observe("mate-thread", [
    devServerRow(1, { running: true, migratedToSupervisor: true }),
    devServerRow(2, { running: true }),
  ] as never);
  expect([
    w.pending("crew.host.freeze", "appdev") !== undefined,
    w.pending("crew.recover", "appdev") !== undefined,
  ]).toEqual([true, true]);
});

// witness: apps/server/src/zerops/crew/engine/decide.advance.ts | task.nudgedAttempt === task.counters.attempt → task.nudgedAttempt === task.counters.attempt - 1
it("CD7: In a run, a turn that ends without a report gets one nudge", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  w.press({ _tag: "start", ...OPTIONS }, OTHER);
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.end("reviewer");
  w.run("reviewer");
  w.end("reviewer");
  expect(w.turns("reviewer")).toEqual(["task", "nudge"]);
});

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | reachedLimit(b.state, run, b.now) === "budget" → reachedLimit(b.state, run, b.now) === "time"
it("CD8: A turn its agent ends at the run's budget stops its task at the budget, and is never sent again", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  w.press({ _tag: "start", ...OPTIONS, budgetUsd: 0.05 }, OTHER);
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.end(
    "reviewer",
    { kind: "failed", reason: "Reached maximum budget ($0.05)", next: null },
    { costUsd: 0.054 },
  );
  expect([
    w.turns("reviewer"),
    w.task(1).state,
    w.task(1).midway?.ending,
    w.state.run?.spentUsd,
  ]).toEqual([["task"], "working", "budget", 0.054]);
});

// witness: apps/server/src/zerops/crew/engine/decide.run.ts | if (!sessionHadTurn(member.session)) continue; → if (member.session.running === null) continue;
it("CD79: A run's start opens no new session for a crewmate whose session has had no turn yet, and one that has had a turn goes on in a new session", () => {
  const w = new CrewWorld();
  w.apply(home(writer("backend"), reader("reviewer")));
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.end("reviewer");
  run(w, "person");
  expect([sessions(w, "backend"), sessions(w, "reviewer")]).toEqual([0, 1]);
});

// witness: apps/server/src/zerops/crew/engine/decide.advance.ts | member.carryOn.as === null && run === undefined → member.carryOn.as === null && b.state.run === null
it("CD9: A restart sends no turn into a run the person paused; Resume carries the task on", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  w.press({ _tag: "start", ...OPTIONS }, OTHER);
  newTask(w, "reviewer", "Read it");
  w.run("reviewer");
  w.press({ _tag: "pause", runId: w.state.run!.id });
  w.quiet();
  w.end("reviewer", CUT);
  restarted(w);
  const held = w.turns("reviewer");
  w.press({ _tag: "resume", runId: w.state.run!.id });
  expect([held, w.turns("reviewer")]).toEqual([["task"], ["task", "continue"]]);
});

// witness: apps/server/src/zerops/crew/engine/decide.effects.ts | if (open !== undefined && CHECKED_STATES.has(open.state)) { → if (open !== undefined && open.state === "checking") {
it("CD10: Edits a restart found on a checked copy stop its task; they never land", () => {
  const w = new CrewWorld();
  w.apply(home(writer("backend")));
  newTask(w, "backend", "First");
  w.start("backend");
  w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
  w.end("backend");
  w.checkpoint("backend");
  w.mergeAndCheck("backend");
  restarted(w);
  const sweep = w.pending("crew.sweep", "backend")?.payload;
  w.settle("crew.sweep", "backend", { swept: false, copy: { _tag: "held" } });
  expect([sweep?.kind === "crew.sweep" && sweep.checked, w.task(1).state]).toEqual([
    true,
    "parked",
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.effects.ts | task === undefined || task.state !== "landing") return; → task === undefined || task.state !== "landing" || task.landAs?.kind !== "person") return;
it("CD11: With Land when the check passes, a run lands a task without a press", () => {
  const w = new CrewWorld();
  working(w);
  run(w, "check");
  finish(w, "backend");
  w.settle("crew.land", "backend", LANDED);
  expect([w.task(1).state, w.task(1).landedCommit]).toEqual(["landed", COMMIT]);
});

// witness: apps/server/src/zerops/crew/engine/decide.advance.ts | landing === "check" || (landing === "lead" → landing !== "lead" || (landing === "lead"
it("CD12: With I land everything, a run leaves a ready task for your Land", () => {
  const w = new CrewWorld();
  working(w);
  run(w, "person");
  finish(w, "backend");
  w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 10 });
  expect([w.task(1).state, w.pending("crew.land", "backend")]).toEqual(["ready", undefined]);
});

// witness: apps/server/src/zerops/crew/engine/decide.effects.ts | park(b, task, MOVED_AFTER_CHECK); → if (task.check === null) park(b, task, MOVED_AFTER_CHECK);
it("CD13: Land refuses a copy that moved after its check and lands nothing", () => {
  const w = new CrewWorld();
  working(w);
  finish(w, "backend");
  w.press({ _tag: "land", taskId: w.task(1).id });
  w.settle("crew.land", "backend", { _tag: "unchecked" });
  expect([w.task(1).state, w.task(1).landedCommit]).toEqual(["parked", null]);
});

// witness: apps/server/src/zerops/crew/engine/decide.effects.ts | saved._tag === "edited-after-check" && CHECKED_STATES.has(task.state) → saved._tag === "edited-after-check" && task.state === "checking"
it("CD14: A turn's end never commits edits on a checked copy: its task stops", () => {
  const w = new CrewWorld();
  working(w);
  finish(w, "backend");
  w.selfRun("backend");
  w.end("backend");
  w.settle("crew.checkpoint", "backend", { _tag: "edited-after-check" });
  expect(w.task(1).state).toEqual("parked");
});

// witness: apps/server/src/zerops/crew/engine/decide.run.ts | note.runId !== runId || note.text.trim() === "" → note.runId === runId || note.text.trim() === ""
it("CD15: A crewmate's question goes to the lead first; the lead's reply is its answer", () => {
  const w = new CrewWorld();
  w.apply(home(lead(), reader("reviewer")));
  w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
  newTask(w, "reviewer", "Prices");
  w.run("reviewer");
  asks(w, "reviewer", "CZK or EUR?");
  w.end("reviewer");
  w.run("lead");
  w.says("lead", "EUR.");
  w.end("lead");
  expect([
    w.turns("lead"),
    w.turns("reviewer"),
    w.task(1).state,
    // The lead's turn ending is not its crewmate's: the answered task stands open.
    w.task(1).midway,
  ]).toEqual([["question"], ["task", "answer"], "working", null]);
});

// witness: apps/server/src/zerops/crew/engine/decide.turns.ts | review: task.review?.verdict === "accept" ? null : task.review → review: task.review
it("CD16: A task back from rework is reviewed afresh, its earlier accept gone", () => {
  const w = new CrewWorld();
  w.apply(home(lead(), writer("backend")));
  w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
  w.quiet();
  newTask(w, "backend", "First");
  w.start("backend");
  finish(w, "backend");
  w.run("lead");
  w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
  w.end("lead");
  w.settle("crew.land", "backend", { _tag: "head-moved" });
  w.settle("crew.mergeIn", "backend", {
    _tag: "conflict",
    head: "h".repeat(40),
    paths: ["hud.ts"],
  });
  w.run("backend");
  const accept = w.task(1).review;
  w.advance(2 * 60_000);
  finish(w, "backend");
  expect([accept, w.task(1).state, w.turns("backend"), w.turns("lead")]).toEqual([
    null,
    "review",
    ["task", "resolve"],
    ["review", "review"],
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.land.ts | if (review.state !== "blocked") continue; → if (review.state !== "working") continue;
it("CD+1: A reader blocked while the task it reviews went back to its builder goes on with its review, unasked, once that task is back in review", () => {
  const w = underReview();
  // The lead's wake for #1 waits for the reader's verdict.
  w.run("lead");
  w.end("lead");
  asks(w, "reviewer", "The app does not answer. Is it running?");
  w.end("reviewer");
  for (const wake of w.armed("lead-wake")) {
    w.advance(wake.dueAt - w.now);
    w.fire("lead-wake", wake.key);
  }
  // The lead sends #1 back and passes the question on: only #1's rework answers it.
  w.run("lead");
  w.tool("lead", {
    tool: "review",
    input: { task: 1, verdict: "reject", note: "Make it answer." },
  });
  w.tool("lead", {
    tool: "report",
    input: { status: "blocked", summary: "?", question: "Resume the review once #1 is back." },
  });
  w.end("lead");
  const waiting = w.task(2).state;
  w.run("backend");
  finish(w, "backend");
  expect([waiting, w.task(1).state, w.task(2).state, w.turns("reviewer")]).toEqual([
    "blocked",
    "review",
    "working",
    ["task", "continue"],
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.observed.ts | set: { starting: null, cantStart: { text: words, at: event.at } }, → set: { starting: null },
it("CD17: A queued task admission refuses stays queued with a Can't start row", () => {
  const w = new CrewWorld();
  w.apply(home(reader("reviewer")));
  newTask(w, "reviewer", "Read it");
  w.refuse("reviewer", "not the login's signer");
  w.advance(60_000).tell({ _tag: "Gauge", login: "other", usagePercent: 3 });
  const task = w.task(1);
  expect(task.cantStart).not.toBeNull();
  expect([task.state, w.turns("reviewer").length]).toEqual(["queued", 1]);
});

// witness: apps/server/src/zerops/crew/engine/decide.step.ts | if (copyBusy(b.state, handle)) throw wrongState(busyWords(handle)); → if (copyBusy(b.state, handle) && !Object.values(b.state.effects).some((effect) => effect.handle === handle && effect.kind === "crew.check")) throw wrongState(busyWords(handle));
it("CD18: A discard while the check runs is refused as busy, and the check is not undone", () => {
  const w = new CrewWorld();
  w.apply(home(writer("backend")));
  newTask(w, "backend", "First");
  w.start("backend");
  w.tool("backend", { tool: "report", input: { status: "done", summary: "Done." } });
  w.end("backend");
  w.checkpoint("backend");
  w.settle("crew.mergeIn", "backend", { _tag: "merged", head: "h".repeat(40) });
  w.press({ _tag: "discard", taskId: w.task(1).id });
  const refused = w.rejection();
  w.settle("crew.check", "backend", { _tag: "passed", tail: "ok", tip: null });
  expect([refused, w.task(1).state]).toEqual(["wrong-state", "ready"]);
});

// witness: apps/server/src/zerops/crew/engine/decide.presses.ts | refusal !== null && reach.kind !== "reads" && reach.kind !== "stops" → refusal !== null && reach.kind !== "reads"
it("CD19: The crew's door lets a colleague who may run no login pause and stop a running crew, its turns interrupted, and nothing more", () => {
  const w = crew();
  w.press({ _tag: "start", ...OPTIONS });
  w.quiet();
  w.start("backend");
  const runId = w.state.run!.id;
  w.tell({ _tag: "Press", press: { _tag: "pause", runId }, door: { refusal: EVAS } }, OTHER);
  const paused = [w.state.run?.state, w.controls("backend").at(-1)];
  w.tell({ _tag: "Press", press: { _tag: "stop", runId }, door: { refusal: EVAS } }, OTHER);
  w.tell({ _tag: "Press", press: { _tag: "resume", runId }, door: { refusal: EVAS } }, OTHER);
  expect([paused, w.state.run?.state, w.rejection()]).toEqual([
    ["paused", "Stop"],
    "stopped",
    "not-allowed",
  ]);
});

const bobOnPool = writer("bob", { pool: "tinypool", host: "tinypool-1", leaseId: "lease-1" });

// witness: apps/server/src/zerops/crew/engine/decide.home.ts | if (old.pool != null) removeLane(b, old, false); → if (old.pool == null) removeLane(b, old, false);
it("CD20: Apply that drops a writer whose copy is on a pool's lease removes the copy as Remove from crew does, and the lease goes with it", () => {
  const w = new CrewWorld();
  w.apply(home(bobOnPool, writer("ada")));
  w.apply(home());
  expect(w.pending("crew.lane.remove", "bob")?.payload).toEqual({
    kind: "crew.lane.remove",
    handle: "bob",
    discardUnlanded: false,
    host: "tinypool-1",
    lease: { id: "lease-1" },
  });
  expect(w.pending("crew.lane.remove", "ada")).toBeUndefined();
  expect(w.state.hosts["tinypool-1"]).toBeUndefined();
});

// witness: apps/server/src/zerops/crew/engine/decide.effects.ts | its lease ${pending.host} stays → its lease ${pending.handle} stays
it("CD21: A copy's lease zcp keeps at its removal is named, and the crewmate is still removed", () => {
  const w = new CrewWorld();
  w.apply(home(bobOnPool));
  w.press({ _tag: "removeCrewmate", handle: "bob", discardUnlanded: false });
  expect(w.pending("crew.lane.remove", "bob")?.payload).toMatchObject({
    lease: { id: "lease-1" },
  });
  w.settle("crew.lane.remove", "bob", {
    _tag: "lease-kept",
    detail: "commit abc123 saved locally",
  });
  expect(w.state.members.bob).toBeUndefined();
  expect(w.state.lastError).toContain("tinypool-1");
  expect(w.state.lastError).toContain("commit abc123 saved locally");
});

// witness: apps/server/src/zerops/crew/engine/decide.home.ts | leaseId: writer ? (spec.leaseId ?? null) : null → leaseId: writer && existing === undefined ? (spec.leaseId ?? null) : null
it("CD22: A writer's copy lease is given back by the id zcp gave it, never by its branch", () => {
  const w = new CrewWorld();
  w.apply(home(bobOnPool));
  w.apply(home(bobOnPool));
  w.press({ _tag: "removeCrewmate", handle: "bob", discardUnlanded: false });
  const removal = w.pending("crew.lane.remove", "bob")?.payload;
  expect(removal?.kind === "crew.lane.remove" && removal.lease).toEqual({ id: "lease-1" });
});

// witness: apps/server/src/zerops/crew/engine/decide.effects.ts | copy on ${pending.host} had already ended → copy on ${pending.handle} had already ended
it("CD23: A copy whose lease had already ended is removed and says so", () => {
  const w = new CrewWorld();
  w.apply(home(bobOnPool));
  w.press({ _tag: "removeCrewmate", handle: "bob", discardUnlanded: false });
  w.settle("crew.lane.remove", "bob", { _tag: "lease-ended" });
  expect(w.state.members.bob).toBeUndefined();
  expect(w.state.lastError).toContain("@bob's copy on tinypool-1 had already ended");
  expect(w.state.lastError).toContain("Bob is removed");
});

// witness: apps/server/src/zerops/crew/engine/decide.presses.ts | tasksOf(b.state, member.handle).map(taskAssignment) → Object.values(b.state.tasks).map(taskAssignment)
it("CD24: Discarding a writer's task keeps its attempt aside naming every task of that crewmate and no other crewmate's, so the kept-attempt bound never prunes another crewmate's work", () => {
  const w = new CrewWorld();
  w.now = 36;
  w.apply(home(writer("ada"), writer("bob")));
  newTask(w, "ada", "First");
  newTask(w, "bob", "Other writer");
  w.start("ada");
  newTask(w, "ada", "Next");
  finish(w, "ada");
  w.press({ _tag: "discard", taskId: w.task(1).id });
  const keep = w.pending("crew.lane.keep", "ada")?.payload;
  expect(keep?.kind === "crew.lane.keep" && keep.laneAssignments).toEqual([
    "task-1-10",
    "task-3-10",
  ]);
});

// witness: apps/server/src/zerops/crew/engine/evolve.ts | applied: null, → applied: state.applied,
it("CD25: Remove the crew takes every crewmate off as Remove from crew does, a pool writer's copy lease by its id, and leaves no crew", () => {
  const w = new CrewWorld().apply(home(lead(), bobOnPool));
  const conversations = [w.state.members.lead!.conversationId, w.state.members.bob!.conversationId];
  w.press({ _tag: "removeCrew" });
  expect(w.state.applied).toBeNull();
  expect(w.state.members).toEqual({});
  expect(w.pending("crew.lane.remove", "bob")?.payload).toMatchObject({
    discardUnlanded: false,
    lease: { id: "lease-1" },
  });
  expect(
    w.effects.flatMap(({ payload }) =>
      payload.kind === "crew.deliver" && payload.command._tag === "Archive"
        ? [payload.conversationId]
        : [],
    ),
  ).toEqual(conversations);
});

// witness: apps/server/src/zerops/crew/engine/decide.presses.ts | requireRemovable(b, member, false); → requireRemovable(b, member, true);
it("CD26: Remove the crew is refused while a run is on or a crewmate's copy holds work not landed, and nothing changes", () => {
  const w = new CrewWorld().apply(home(bobOnPool));
  w.press({ _tag: "start", ...OPTIONS });
  const running = w.state;
  w.press({ _tag: "removeCrew" });
  expect(w.rejection()).toBe("wrong-state");
  expect(w.state).toBe(running);
  w.press({ _tag: "stop", runId: running.run!.id });
  newTask(w, "bob", "Edit the board");
  w.start("bob");
  w.end("bob");
  w.settle("crew.checkpoint", "bob", {
    _tag: "committed",
    stats: { ahead: 1, insertions: 1, deletions: 0, dirty: false },
  });
  const before = w.state;
  w.press({ _tag: "removeCrew" });
  expect(w.rejection()).toBe("unlanded-commits");
  expect(w.state).toBe(before);
});

/** The lead plans a reader's review of a writer's task, and the person starts it. */
const reviewPlanned = (w: CrewWorld, reviews: string) => {
  w.tool("lead", {
    tool: "propose",
    plan: [{ owner: "reviewer", title: `Review ${reviews}`, brief: "Check it.", reviews }],
  });
  const review = Object.values(w.state.tasks).find((task) => task.owner === "reviewer")!;
  w.press({ _tag: "planAccept", taskIds: [review.id] });
};

/** A writer's #1 in the lead's review, and a reader at work on #2, which reviews it. */
const underReview = () => {
  const w = new CrewWorld();
  w.apply(home(lead(), writer("backend"), reader("reviewer")));
  w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
  w.quiet();
  newTask(w, "backend", "First");
  w.start("backend");
  finish(w, "backend");
  reviewPlanned(w, "#1");
  w.run("reviewer");
  return w;
};

const lands = (w: CrewWorld, handle: string) => w.pending("crew.land", handle) !== undefined;

// witness: apps/server/src/zerops/crew/engine/decide.tools.ts | if (member.kind !== "lead") return readerVerdict(b, member, task, call.input); → if (member.kind === "writer") return readerVerdict(b, member, task, call.input);
it("CD80: A reader's verdict lands nothing: it waits on the reader's own task for the lead, and only the lead's accept lands the task it reviews", () => {
  const w = underReview();
  w.tool("reviewer", { tool: "review", input: { task: 1, verdict: "accept", note: "Checked." } });
  const after = [w.task(1).state, lands(w, "backend"), w.task(2).verdict];
  w.tool("lead", { tool: "review", input: { task: 1, verdict: "accept", note: "" } });
  expect([...after, lands(w, "backend")]).toEqual([
    "review",
    false,
    { verdict: "accept", note: "Checked." },
    true,
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.tools.ts | if (given.id !== task.id) { → if (given.id === task.id) {
it("CD81: A reader gives its verdict only on the task its own task reviews: one on another task is refused and changes nothing", () => {
  const w = new CrewWorld();
  w.apply(home(lead(), writer("ada"), writer("bob"), reader("reviewer")));
  w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
  w.quiet();
  newTask(w, "ada", "Menu");
  newTask(w, "bob", "Score");
  w.start("ada");
  w.start("bob");
  finish(w, "ada");
  finish(w, "bob");
  reviewPlanned(w, "#1");
  w.run("reviewer");
  w.tool("reviewer", { tool: "review", input: { task: 2, verdict: "reject", note: "No." } });
  expect([w.reply()?.isError, w.task(2).state, w.task(3).verdict]).toEqual([
    true,
    "review",
    undefined,
  ]);
});

// witness: apps/server/src/zerops/crew/engine/decide.advance.ts | (task.reviews === undefined || b.state.tasks[task.reviews]?.state === "review"), → true,
it("CD82: A reader's task that reviews another starts only once that task is in review, and the lead is woken for that task only once the reader reported", () => {
  const w = new CrewWorld();
  w.apply(home(lead(), writer("backend"), reader("reviewer")));
  w.press({ _tag: "start", ...LEAD_LANDS }, OTHER);
  w.quiet();
  newTask(w, "backend", "First");
  w.start("backend");
  reviewPlanned(w, "#1");
  const early = w.turns("reviewer").length;
  finish(w, "backend");
  w.run("reviewer");
  const beforeReport = w.turns("lead").length;
  w.tool("reviewer", { tool: "report", input: { status: "done", summary: "Looks right." } });
  w.end("reviewer");
  expect([early, beforeReport, w.turns("lead")]).toEqual([0, 0, ["review"]]);
});
