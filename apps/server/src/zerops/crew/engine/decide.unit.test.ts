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

// witness: apps/server/src/zerops/crew/engine/decide.ts | if (moved?.state !== "working") return; → if (moved === undefined) return;
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | end.reason === AGENT_STOPPED_ITSELF && event.detail === undefined → end.reason === AGENT_STOPPED_ITSELF && event.detail === "provider-error"
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | events.filter((event) => event.seq > cursor) → events.filter((event) => event.seq >= cursor)
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | first.seq > cursor + 1 → first.seq > cursor + 2
it("CD6: A batch that starts past the crew's cursor is refused, so no event of a record is skipped", () => {
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | task.nudgedAttempt === task.counters.attempt → task.nudgedAttempt === task.counters.attempt - 1
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | reachedLimit(b.state, run, b.now) === "budget" → reachedLimit(b.state, run, b.now) === "time"
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | member.carryOn.as === null && run === undefined → member.carryOn.as === null && b.state.run === null
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | if (open !== undefined && CHECKED_STATES.has(open.state)) { → if (open !== undefined && open.state === "checking") {
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | task === undefined || task.state !== "landing") return; → task === undefined || task.state !== "landing" || task.landAs?.kind !== "person") return;
it("CD11: With Land when the check passes, a run lands a task without a press", () => {
  const w = new CrewWorld();
  working(w);
  run(w, "check");
  finish(w, "backend");
  w.settle("crew.land", "backend", LANDED);
  expect([w.task(1).state, w.task(1).landedCommit]).toEqual(["landed", COMMIT]);
});

// witness: apps/server/src/zerops/crew/engine/decide.ts | landing === "check" || (landing === "lead" → landing !== "lead" || (landing === "lead"
it("CD12: With I land everything, a run leaves a ready task for your Land", () => {
  const w = new CrewWorld();
  working(w);
  run(w, "person");
  finish(w, "backend");
  w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: 10 });
  expect([w.task(1).state, w.pending("crew.land", "backend")]).toEqual(["ready", undefined]);
});

// witness: apps/server/src/zerops/crew/engine/decide.ts | park(b, task, MOVED_AFTER_CHECK); → if (task.check === null) park(b, task, MOVED_AFTER_CHECK);
it("CD13: Land refuses a copy that moved after its check and lands nothing", () => {
  const w = new CrewWorld();
  working(w);
  finish(w, "backend");
  w.press({ _tag: "land", taskId: w.task(1).id });
  w.settle("crew.land", "backend", { _tag: "unchecked" });
  expect([w.task(1).state, w.task(1).landedCommit]).toEqual(["parked", null]);
});

// witness: apps/server/src/zerops/crew/engine/decide.ts | saved._tag === "edited-after-check" && CHECKED_STATES.has(task.state) → saved._tag === "edited-after-check" && task.state === "checking"
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | set: { starting: null, cantStart: { text: words, at: event.at } }, → set: { starting: null },
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

// witness: apps/server/src/zerops/crew/engine/decide.ts | refusal !== null && reach.kind !== "reads" && reach.kind !== "stops" → refusal !== null && reach.kind !== "reads"
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
