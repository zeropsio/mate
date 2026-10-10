/**
 * The oracle: after every op, what the live client reads is held against the tree (what happened,
 * whose it is, how it ended) and against itself a moment before; at a reload, and at the end, a
 * fresh client's reading of the same record is held against the live one. Each finding names its
 * rule — the product sentence it breaks — so a minimised tree is one defect.
 */
import type { Model, Status } from "./tree.ts";
import type { CardReading, Reading } from "./reading.ts";

export interface Finding {
  readonly rule: Rule;
  readonly words: string;
}

export const RULES = {
  same: "a reload reads every card as the live client read it",
  counts: "a settled card counts the Mate's own commands and helpers, as the tree ran them",
  owner:
    "every line sits on the card of the run that started it, under the Mate or helper whose it is",
  whole: "every piece of the Mate's own work is on its card, once",
  ends: "every piece of work reads its true end — finished, failed with its exit, stopped, didn't report back",
  back: "nothing that ended reads running again, and a card never loses a line it showed",
  settles: "once everything ended, no card waits or works",
} as const;
export type Rule = keyof typeof RULES;

/** How a background job's line says each end. */
const JOB_STATE: Record<Status, string> = {
  running: "running",
  completed: "done",
  failed: "failed",
  stopped: "stopped",
  lost: "lost",
};

/** How the helpers' surface says each end. */
const HELPER_STATE: Record<Status, ReadonlyArray<string>> = {
  running: ["pending", "running", "waiting"],
  completed: ["completed"],
  failed: ["failed"],
  stopped: ["cancelled"],
  lost: ["interrupted"],
};

const count = (words: string | null, noun: string): number => {
  const found = words?.match(new RegExp(`(\\d+|a|an) ${noun}s?\\b`, "u"))?.[1];
  return found === undefined ? 0 : found === "a" || found === "an" ? 1 : Number(found);
};

/** The checks of one reading against the tree. */
export function checkReading(model: Model, reading: Reading, settled: boolean): Finding[] {
  const findings: Finding[] = [];
  const say = (rule: Rule, words: string) => findings.push({ rule, words });
  const entity = (id: string) => model.entities.get(id);
  const mates = (card: string, kind: "call" | "job" | "helper") =>
    [...model.entities.values()].filter(
      (each) => each.owner === null && each.kind === kind && each.card === card,
    );

  for (const card of reading.cards) {
    // (c) Every line on the card is the Mate's own, from a run of this card.
    for (const step of card.steps) {
      const it = entity(step.what);
      if (it === undefined) continue;
      // A helper is its row of helpers, never its launch call's step: a launch returns at once,
      // and its step read "1s" while the helper worked on (Milo's third stress run).
      if (it.kind === "helper")
        say("ends", `${card.card} draws ${it.id}'s launch as a step reading ${step.state}`);
      else if (it.owner !== null)
        say(
          "owner",
          `${card.card} draws ${it.id}, ${it.owner}'s own ${it.kind}, as the Mate's step`,
        );
      else if (it.card !== card.card)
        say("owner", `${card.card} draws ${it.id}, which belongs on ${it.card}`);
    }
    for (const spawn of card.spawns)
      for (const id of spawn.helpers) {
        const it = entity(id);
        if (it === undefined) continue;
        if (it.owner !== null)
          say(
            "owner",
            `${card.card} says "${spawn.words}" counting ${id}, which ${it.owner} started`,
          );
        else if (it.card !== card.card)
          say(
            "owner",
            `${card.card} says "${spawn.words}" counting ${id}, which belongs on ${it.card}`,
          );
      }
    for (const line of card.background)
      for (const job of line.jobs) {
        const it = entity(job.what);
        if (it === undefined) continue;
        if (it.owner !== null)
          say("owner", `${card.card}'s line "${line.words}" lists ${it.id}, ${it.owner}'s own job`);
        else if (it.card !== card.card)
          say(
            "owner",
            `${card.card}'s line "${line.words}" lists ${it.id}, which belongs on ${it.card}`,
          );
      }

    // (d) Each job and helper the card names reads how it stands.
    const jobStates = new Map<string, Set<string>>();
    const note = (id: string, state: string) =>
      jobStates.set(id, (jobStates.get(id) ?? new Set()).add(state));
    for (const step of card.steps) if (step.job !== undefined) note(step.what, step.job.state);
    for (const line of card.background) for (const job of line.jobs) note(job.what, job.state);
    for (const [id, states] of jobStates) {
      const it = entity(id);
      if (it === undefined || it.owner !== null) continue;
      if (states.size > 1)
        say("ends", `${card.card} reads ${id} as ${[...states].join(" and ")} at once`);
      const want = JOB_STATE[it.status];
      if (!states.has(want))
        say("ends", `${card.card} reads ${id} as ${[...states].join("/")}; it ${it.status}`);
    }
    for (const step of card.steps) {
      const it = entity(step.what);
      if (it?.status === "failed" && it.kind === "job" && it.exit !== undefined)
        if (step.job !== undefined && !(step.job.report ?? "").includes(String(it.exit)))
          say(
            "ends",
            `${card.card} reads ${id(it)} failed with no exit code (it exited ${it.exit})`,
          );
    }
    for (const spawn of card.spawns) {
      const members = spawn.helpers.flatMap((each) => entity(each) ?? []);
      const failed = members.some((each) => each.status === "failed");
      if (failed && !spawn.failed)
        say("ends", `${card.card}'s "${spawn.words}" has no failure mark, though a helper failed`);
      // Once none works, how each that did not finish ended is said on the bubble.
      const ends = [
        ["failed", "failed"],
        ["stopped", "stopped"],
        ["lost", "didn't report back"],
      ] as const;
      if (!members.some((each) => each.status === "running"))
        for (const [status, words] of ends) {
          const n = members.filter((each) => each.status === status).length;
          if (n > 0 && !(spawn.ended ?? "").includes(`${n} ${words}`))
            say(
              "ends",
              `${card.card}'s "${spawn.words}" says ${spawn.ended ?? "nothing"}; ${n} of them ${status}`,
            );
        }
    }

    // (b) A settled card's counts.
    if (!card.live && card.effort !== null) {
      const commands = mates(card.card, "call").length + mates(card.card, "job").length;
      const helpers = mates(card.card, "helper").length;
      const said = {
        commands: count(card.effort, "command"),
        helpers: count(card.effort, "helper"),
      };
      if (said.commands !== commands || said.helpers !== helpers)
        say(
          "counts",
          `${card.card} reads "${card.effort}"; the Mate ran ${commands} commands and ${helpers} helpers there`,
        );
    }
    // (d) What a card whose runs are over waits on: the Mate's own commands still running, and
    // its helpers (with whatever they started) still at it.
    if (card.line.startsWith("Waiting for its") || /^Waiting for \d+ background/u.test(card.line)) {
      const running = (kind: "job" | "helper") =>
        [...model.entities.values()].filter(
          (each) => each.kind === kind && each.status === "running" && each.card === card.card,
        );
      const commands = running("job").filter((each) => each.owner === null).length;
      const helpers =
        running("helper").length + running("job").filter((each) => each.owner !== null).length;
      const saidCommands = count(
        card.line.replace(/\bits background command\b/u, "a background command"),
        "background command",
      );
      const saidHelpers = card.line.includes("helpers");
      if (saidCommands !== commands || saidHelpers !== helpers > 0)
        say(
          "ends",
          `${card.card} reads "${card.line}"; ${commands} of the Mate's commands and ${helpers} helpers' pieces still run`,
        );
    }
    if (settled && card.live)
      say("settles", `${card.card} still reads "${card.line}" with everything ended`);
  }

  // The helpers' surface: each helper once, in its state, under the helper that started it.
  for (const it of model.entities.values()) {
    if (it.kind !== "helper" || it.card === null) continue;
    const rows = reading.helpers.filter((row) => row.what === it.id);
    if (rows.length !== 1) {
      say("whole", `the helpers' surface lists ${it.id} ${rows.length} times`);
      continue;
    }
    const row = rows[0]!;
    if (row.parent !== it.owner)
      say(
        "owner",
        `the helpers' surface puts ${it.id} under ${row.parent ?? "the Mate"}; ${it.owner ?? "the Mate"} started it`,
      );
    if (!HELPER_STATE[it.status].includes(row.status))
      say("ends", `the helpers' surface reads ${it.id} as ${row.status}; it ${it.status}`);
  }
  // The dock: the Mate's own background jobs, never a helper's.
  for (const row of reading.dock) {
    const it = entity(row.what);
    if (it === undefined) continue;
    if (it.owner !== null) say("owner", `the dock lists ${it.id}, ${it.owner}'s own job`);
    else if (
      row.state !== JOB_STATE[it.status] &&
      !(it.status === "completed" && row.state === "done")
    )
      say("ends", `the dock reads ${it.id} as ${row.state}; it ${it.status}`);
  }
  return findings;
}

const id = (it: { readonly id: string }) => it.id;

/**
 * What the live client read, against what it read a moment before: an entity that read ended never
 * reads running again; a card never loses a line it showed.
 */
export function checkSince(before: Reading | null, now: Reading): Finding[] {
  if (before === null) return [];
  const findings: Finding[] = [];
  const statesOf = (reading: Reading) => {
    const states = new Map<string, string>();
    for (const card of reading.cards) {
      for (const step of card.steps) if (step.job) states.set(step.what, step.job.state);
      for (const line of card.background)
        for (const job of line.jobs) states.set(job.what, job.state);
    }
    for (const row of reading.helpers) states.set(row.what, row.status);
    return states;
  };
  const was = statesOf(before);
  for (const [what, state] of statesOf(now)) {
    const prior = was.get(what);
    if (prior !== undefined && prior !== "running" && prior !== "pending" && state === "running")
      findings.push({ rule: "back", words: `${what} read ${prior}, then running again` });
  }
  const linesOf = (card: CardReading) => card.steps.map((step) => step.what);
  for (const card of before.cards) {
    const after = now.cards.find((each) => each.card === card.card);
    const lost = linesOf(card).filter((line) => !after || !linesOf(after).includes(line));
    if (lost.length > 0)
      findings.push({
        rule: "back",
        words: `${card.card} lost ${lost.join(", ")}${after === undefined ? " (the card went)" : ""}`,
      });
  }
  return findings;
}

/** A fresh client's reading against the live one: the first place they differ. */
export function checkSame(live: Reading, reload: Reading): Finding[] {
  const findings: Finding[] = [];
  const diff = (path: string, a: unknown, b: unknown) => {
    const left = JSON.stringify(a);
    const right = JSON.stringify(b);
    if (left !== right)
      findings.push({ rule: "same", words: `${path}: live ${left}, after a reload ${right}` });
  };
  const cards = new Set([...live.cards, ...reload.cards].map((card) => card.card));
  for (const card of cards) {
    const a = live.cards.find((each) => each.card === card);
    const b = reload.cards.find((each) => each.card === card);
    if (a === undefined || b === undefined) {
      diff(`${card}`, a === undefined ? null : "card", b === undefined ? null : "card");
      continue;
    }
    diff(`${card} line`, a.line, b.line);
    diff(`${card} effort`, a.effort, b.effort);
    diff(`${card} steps`, a.steps, b.steps);
    diff(`${card} helpers started`, a.spawns, b.spawns);
    diff(`${card} reports`, a.reports, b.reports);
    diff(`${card} background lines`, a.background, b.background);
  }
  diff("the helpers' surface", live.helpers, reload.helpers);
  diff("the dock", live.dock, reload.dock);
  return findings;
}

/** A closed card's face — its line, its effort, the lines under it — before any of it is opened. */
export function checkFace(live: Reading, reload: Reading): Finding[] {
  const findings: Finding[] = [];
  for (const card of reload.cards) {
    const was = live.cards.find((each) => each.card === card.card);
    if (was === undefined || was.live) continue;
    const face = (each: CardReading) => ({
      line: each.line,
      effort: each.effort,
      background: each.background.map((line) => line.words),
    });
    const left = JSON.stringify(face(was));
    const right = JSON.stringify(face(card));
    if (left !== right)
      findings.push({
        rule: "same",
        words: `${card.card}'s closed face: live ${left}, after a reload ${right}`,
      });
  }
  return findings;
}
