/**
 * An asked effect's outcome: what a settled delivery, save, merge-in, check, landing, claim read or sweep does to the crew, and an effect that failed for good.
 *
 * @module crew/engine/decide.effects
 */
import { type EffectId } from "@t3tools/contracts";
import { CHECKED_STATES, EDITED_AFTER_CHECK, MOVED_AFTER_CHECK } from "../crewMachines.ts";
import { taskCard } from "./cards.ts";
import { type CrewEffectPayload, type CrewEffectValues, type CrewInput } from "./command.ts";
import { openTaskOf, type MemberRecord, type PendingEffect, type TaskRecord } from "./state.ts";
import {
  INDEX_LOCK,
  type Builder,
  userOf,
  dispatchPrincipal,
  step,
  park,
  statsSet,
  laneEnvironmentOf,
} from "./decide.step.ts";
import { sendTurn } from "./decide.turns.ts";
import { seam, mergeIn, checkPassed } from "./decide.land.ts";
import { claimRead } from "./decide.claims.ts";
import { type Ending, turnEnded } from "./decide.observed.ts";
import { frozenWords, timingOf, recovering, recover, thaw } from "./decide.host.ts";

const valueOf = <K extends keyof CrewEffectValues>(_kind: K, value: unknown): CrewEffectValues[K] =>
  value as CrewEffectValues[K];

export const settled = (
  b: Builder,
  effectId: EffectId,
  outcome: Extract<CrewInput, { _tag: "EffectSettled" }>["outcome"],
): void => {
  const pending = b.state.effects[effectId];
  if (pending === undefined) return;
  b.emit({ _tag: "EffectOutcomeRecorded", effectId, kind: pending.kind, outcome });
  if (outcome.kind !== "ok") return failedForGood(b, effectId, pending, outcome);
  const value = outcome.value;
  const member = pending.handle === null ? undefined : b.state.members[pending.handle];
  const task = pending.taskId === null ? undefined : b.state.tasks[pending.taskId];
  switch (pending.kind) {
    case "crew.deliver": {
      const delivery = b.state.deliveries[effectId];
      const runId = valueOf("crew.deliver", value)?.runId;
      if (delivery === undefined) return;
      if (
        delivery.purpose === "stop" ||
        delivery.purpose === "rotate" ||
        delivery.purpose === "assign" ||
        delivery.purpose === "archive" ||
        delivery.purpose === "seam"
      ) {
        b.emit({ _tag: "DeliveryClosed", effectId });
      } else if (
        runId !== undefined &&
        Object.entries(b.state.deliveries).some(
          ([other, entry]) => other !== effectId && entry.runId === runId,
        )
      ) {
        // It joined a run another delivery queued (a steer): that one carries the run.
        b.emit({ _tag: "DeliveryClosed", effectId });
      } else if (runId !== undefined && delivery.runId === null) {
        b.emit({ _tag: "DeliveryLinked", effectId, runId });
      }
      return;
    }
    case "crew.lane.create": {
      const created = valueOf("crew.lane.create", value);
      if (member?.lane == null) return;
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: {
          lane:
            created._tag === "ready"
              ? { ...member.lane, state: "ready", detail: null }
              : { ...member.lane, state: "failed", detail: created.detail },
        },
      });
      return;
    }
    case "crew.lane.reset": {
      if (member === undefined || task === undefined || task.starting === null) return;
      const reset = valueOf("crew.lane.reset", value);
      switch (reset._tag) {
        case "ready":
          b.emit({
            _tag: "CrewmateUpdated",
            handle: member.handle,
            set: statsSet(reset.stats, member),
          });
          sendTurn(
            b,
            b.state.members[member.handle]!,
            taskCard(task, reset.resetTo),
            task.starting.principal,
            "task",
            task.id,
            task.starting.attachments ?? [],
          );
          return;
        case "dirty":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          b.emit({
            _tag: "AttentionRaised",
            row: {
              id: `preserved:${member.handle}`,
              handle: member.handle,
              taskId: task.id,
              text: "its copy still has preserved edits; continue or preserve them first",
              at: b.now,
            },
          });
          return;
        case "frozen":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          return;
        case "lane-missing":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          if (member.lane !== null) {
            b.emit({
              _tag: "CrewmateUpdated",
              handle: member.handle,
              set: { lane: { ...member.lane, state: "missing" } },
            });
          }
          return;
        case "moved":
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
          park(b, b.task(task.id), "its copy of the code moved outside the engine");
          return;
      }
      return;
    }
    case "crew.lane.keep": {
      if (task === undefined) return;
      const kept = valueOf("crew.lane.keep", value);
      if (kept._tag === "kept") step(b, task, { type: "discard" }, { cantStart: null });
      else
        b.emit({ _tag: "ErrorNoted", text: `#${task.number} was not discarded: ${kept.detail}` });
      return;
    }
    case "crew.lane.remove": {
      const removed = valueOf("crew.lane.remove", value);
      if (removed._tag === "lease-kept") {
        b.emit({
          _tag: "ErrorNoted",
          text: `@${pending.handle}'s copy is removed; its lease ${pending.host} stays: ${removed.detail}`,
        });
      } else if (removed._tag === "lease-ended") {
        const { displayName } = pending.payload as { displayName: string };
        b.emit({
          _tag: "ErrorNoted",
          text: `@${pending.handle}'s copy on ${pending.host} had already ended (its lease was lost); ${displayName} is removed.`,
        });
      } else if (removed._tag === "unlanded-commits") {
        b.emit({
          _tag: "ErrorNoted",
          text: `@${pending.handle}'s copy kept: it has work not landed`,
        });
      }
      return;
    }
    case "crew.checkpoint": {
      if (member === undefined || task === undefined) return;
      const saved = valueOf("crew.checkpoint", value);
      const purpose = (pending.payload as { purpose?: string }).purpose;
      const ending = ((pending.payload as { ending?: Ending }).ending ?? {
        kind: "completed",
      }) as Ending;
      if ("stats" in saved && saved.stats !== undefined) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: statsSet(saved.stats, member),
        });
      } else if (saved._tag === "lane-missing" && member.lane !== null) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { lane: { ...member.lane, state: "missing" } },
        });
      }
      if (saved._tag === "edited-after-check" && CHECKED_STATES.has(task.state)) {
        if (task.checkpointing)
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
        park(b, b.task(task.id), EDITED_AFTER_CHECK);
        return;
      }
      if (saved._tag === "park" && purpose !== "land-now") {
        if (task.checkpointing)
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
        park(b, b.task(task.id), saved.detail);
        return;
      }
      if (purpose === "land-now") {
        if (saved._tag !== "committed" && saved._tag !== "unchanged") {
          b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { landAs: null } });
          b.emit({
            _tag: "ErrorNoted",
            text: `#${task.number}'s copy could not be committed (${saved._tag})`,
          });
          return;
        }
        const merging = step(b, task, { type: "land-now" }, { wait: null, midway: null });
        if (merging !== undefined) mergeIn(b, merging);
        return;
      }
      turnEnded(b, task, ending);
      return;
    }
    case "crew.mergeIn": {
      if (member === undefined || task === undefined || task.state !== "merging") return;
      const merged = valueOf("crew.mergeIn", value);
      switch (merged._tag) {
        case "merged":
        case "current": {
          b.emit({
            _tag: "CrewmateUpdated",
            handle: member.handle,
            set: statsSet(merged.stats, member),
          });
          if (member.check === null || member.host === null) {
            const clean = step(b, task, { type: "merge-clean" }, { wait: null });
            if (clean !== undefined) checkPassed(b, clean);
            return;
          }
          step(
            b,
            task,
            { type: "merge-clean" },
            {
              wait: null,
              check: { state: "running", output: "", tip: null },
            },
          );
          b.effect(
            {
              kind: "crew.check",
              handle: member.handle,
              taskId: task.id,
              attempt: task.counters.attempt,
              command: member.check,
              setup:
                merged._tag === "merged" && merged.lockfileChanged === true ? member.setup : null,
              host: member.host,
              tip: merged.tip ?? null,
              ...laneEnvironmentOf(b.state, member),
            },
            member.handle,
            { handle: member.handle, taskId: task.id, attempt: task.counters.attempt },
          );
          return;
        }
        case "conflict":
          step(
            b,
            task,
            { type: "merge-conflict" },
            {
              wait: { on: "conflict", reason: "conflicts with what landed", paths: merged.paths },
            },
          );
          return;
        case "unrelated":
          step(b, task, { type: "merge-empty-base" });
          return;
        case "frozen":
          b.emit({
            _tag: "ErrorNoted",
            text: `${member.host} is redeploying; #${task.number} merges when it is back.`,
          });
          return;
        case "lane-missing":
          if (member.lane !== null) {
            b.emit({
              _tag: "CrewmateUpdated",
              handle: member.handle,
              set: { lane: { ...member.lane, state: "missing" } },
            });
          }
          park(b, task, "its copy of the code is missing");
          return;
        case "uncommitted":
          park(b, task, "its copy has work the engine did not commit");
          return;
        case "unknown-tip":
          park(b, task, "its copy of the code moved outside the engine");
          return;
      }
      return;
    }
    case "crew.check": {
      if (task === undefined) return;
      // A message sent it back to work meanwhile: the verdict is on a tree that will not land.
      if (task.state !== "checking") {
        if (task.state === "merging") mergeIn(b, task);
        return;
      }
      const checked = valueOf("crew.check", value);
      switch (checked._tag) {
        case "passed":
          checkPassed(b, task, {
            check: { state: "passed", output: checked.tail, tip: checked.tip },
          });
          return;
        case "failed":
          step(
            b,
            task,
            { type: "check-failed" },
            {
              check: { state: "failed", output: checked.tail, tip: null },
              wait: { on: "check-failed", reason: "the check failed", paths: [] },
            },
          );
          return;
        case "timed-out":
          park(b, task, "the check timed out");
          return;
        case "killed":
          park(b, task, "the check was killed");
          return;
        case "setup-failed":
          park(b, task, "its setup failed");
          // The check's command never ran: Continue runs it again from its setup.
          b.emit({
            _tag: "AttentionRaised",
            row: {
              id: effectId,
              handle: task.owner,
              taskId: task.id,
              text: "its setup failed",
              at: b.now,
              operation: {
                kind: "check",
                stage: "setting-up",
                confirmedStage: "setting-up",
                status: "failed",
                resumeState: "checking",
                startedBy: userOf(dispatchPrincipal(b.state, task)),
                attempt: task.counters.attempt,
                row: false,
                redo: pending.payload as CrewEffectPayload,
              },
            },
          });
          return;
        case "lane-missing":
          park(b, task, "its copy of the code is missing");
          return;
        case "moved":
          park(b, task, "its copy of the code moved outside the engine");
          return;
      }
      return;
    }
    case "crew.land":
      return landSettled(b, effectId, member, task, valueOf("crew.land", value));
    case "crew.claim.read":
      return claimRead(b, pending, valueOf("crew.claim.read", value));
    case "crew.app.run":
    case "crew.app.stop":
      if (member !== undefined) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { app: valueOf("crew.app.run", value).state },
        });
      }
      return;
    case "crew.deploy.poll": {
      const host = pending.host!;
      const record = b.state.hosts[host];
      // A read that was in flight when the recovery began must not hold the host it let go.
      if (record?.frozenSince == null || recovering(b, host)) return;
      const phase = valueOf("crew.deploy.poll", value).phase;
      if (phase === "ended") return recover(b, host);
      const unknownSince = phase === "unreadable" ? (record.unknownSince ?? b.now) : null;
      if (unknownSince !== (record.unknownSince ?? null)) {
        b.emit({ _tag: "HostUpdated", host, set: { unknownSince } });
      }
      const words = frozenWords(host, phase);
      if (b.state.lastError !== words) b.emit({ _tag: "ErrorNoted", text: words });
      const offered = b.state.attention.some((row) => row.id === `deploy-unreadable:${host}`);
      if (unknownSince === null) {
        b.cancel("thaw-offer", host, "its redeploy reads again");
        if (offered) b.emit({ _tag: "AttentionCleared", id: `deploy-unreadable:${host}` });
      } else if (!offered) {
        // Unreadable for long enough, the person is offered to say it ended.
        b.arm("thaw-offer", host, unknownSince + timingOf(b.state).thawOfferMs, {
          kind: "engine",
        });
      }
      return;
    }
    case "crew.recover": {
      const recovered = valueOf("crew.recover", value);
      return thaw(b, pending.host!, recovered.lost, recovered.losses ?? []);
    }
    case "crew.host.freeze":
      return;
    case "crew.sweep": {
      const swept = valueOf("crew.sweep", value);
      if (member === undefined) return;
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: statsSet(swept.stats, member),
      });
      return sweptCopy(b, b.state.members[member.handle]!, swept.copy);
    }
    default:
      return;
  }
};

/**
 * What a restart left in a copy: saved work is said in its crewmate's chat, edits on a copy its
 * check passed stop its task, and a copy gone is brought back.
 */
const sweptCopy = (
  b: Builder,
  member: MemberRecord,
  copy: CrewEffectValues["crew.sweep"]["copy"],
): void => {
  switch (copy?._tag) {
    case "committed":
      if (copy.paths.length > 0) {
        seam(b, member, {
          seam: "swept",
          branch: `crew/${member.handle}`,
          commit: copy.commit,
          paths: copy.paths,
        });
      }
      return;
    case "held": {
      const open = openTaskOf(b.state, member.handle);
      if (open !== undefined && CHECKED_STATES.has(open.state)) {
        park(b, open, EDITED_AFTER_CHECK);
      }
      return;
    }
    case "missing":
      if (member.lane !== null) {
        b.emit({
          _tag: "CrewmateUpdated",
          handle: member.handle,
          set: { lane: { ...member.lane, state: "missing" } },
        });
      }
      if (member.host !== null) recover(b, member.host);
      return;
    default:
      return;
  }
};

/** An effect that failed for good: a row on Waiting on you, and the work it held let go. */
const failedForGood = (
  b: Builder,
  effectId: EffectId,
  pending: PendingEffect,
  outcome: Extract<CrewInput, { _tag: "EffectSettled" }>["outcome"],
): void => {
  const reason = outcome.kind === "failed" ? outcome.reason : outcome.kind;
  const task = pending.taskId === null ? undefined : b.state.tasks[pending.taskId];
  if (pending.kind === "crew.deliver") b.emit({ _tag: "DeliveryClosed", effectId });
  if (task?.starting != null) {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { starting: null } });
  }
  if (task?.checkpointing === true) {
    b.emit({ _tag: "TaskUpdated", taskId: task.id, set: { checkpointing: false } });
  }
  b.emit({
    _tag: "AttentionRaised",
    row: {
      id: effectId,
      handle: pending.handle,
      taskId: pending.taskId,
      text: `${pending.kind.replace(/^crew\./u, "")} failed: ${reason}`,
      at: b.now,
    },
  });
};

const landSettled = (
  b: Builder,
  _effectId: EffectId,
  member: MemberRecord | undefined,
  task: TaskRecord | undefined,
  outcome: CrewEffectValues["crew.land"],
): void => {
  if (member === undefined || task === undefined || task.state !== "landing") return;
  const held = (words: string) => b.emit({ _tag: "LandingHeld", taskId: task.id, words });
  switch (outcome._tag) {
    case "landed":
    case "already-landed": {
      b.emit({
        _tag: "CrewmateUpdated",
        handle: member.handle,
        set: statsSet(outcome.stats, member),
      });
      const done = step(
        b,
        task,
        { type: outcome._tag === "landed" ? "fast-forward" : "trailer-found" },
        { landedCommit: outcome.commit, landedAt: b.now, wait: null, landAs: null },
      );
      if (done !== undefined) {
        seam(b, member, {
          seam: "landed",
          taskId: done.id,
          number: done.number,
          commit: outcome.commit,
        });
      }
      return;
    }
    case "nothing": {
      const done = step(
        b,
        task,
        { type: "fast-forward" },
        {
          landedCommit: null,
          landedAt: b.now,
          wait: null,
          landAs: null,
        },
      );
      if (done !== undefined)
        seam(b, member, { seam: "closed", taskId: done.id, number: done.number });
      return;
    }
    case "head-moved":
    case "not-fast-forward": {
      held(
        outcome._tag === "head-moved"
          ? "your tree moved since its check; it merges again"
          : "your tree moved during the landing; it merges again",
      );
      const moved = step(b, task, { type: outcome._tag });
      if (moved?.state === "merging") mergeIn(b, moved);
      return;
    }
    case "dirty-tree":
    case "untracked-in-way":
      held(
        `your tree has ${outcome._tag === "dirty-tree" ? "uncommitted edits" : "untracked files"} in its way: ${outcome.paths.join(", ")}`,
      );
      step(
        b,
        task,
        { type: outcome._tag },
        {
          wait: { on: "your-tree", reason: null, paths: outcome.paths },
          landAs: null,
        },
      );
      return;
    case "index-lock":
      held(INDEX_LOCK);
      b.emit({ _tag: "ErrorNoted", text: `#${task.number} waits to land: ${INDEX_LOCK}` });
      step(b, task, { type: "index-lock" });
      return;
    case "missing-object": {
      held("an object the landing needs was missing; it lands again");
      const retried = task.landRetriedAttempt === task.counters.attempt;
      step(
        b,
        task,
        { type: "missing-object", retried },
        {
          landRetriedAttempt: task.counters.attempt,
        },
      );
      return;
    }
    case "disk-full":
      step(b, task, { type: "disk-full" });
      return;
    case "park":
      park(b, task, outcome.detail);
      return;
    case "uncommitted":
      park(b, task, EDITED_AFTER_CHECK);
      return;
    case "unchecked":
      park(b, task, MOVED_AFTER_CHECK);
      return;
    case "frozen":
    case "lane-missing":
    case "unknown-tip":
      park(b, task, `its copy could not land (${outcome._tag})`);
      return;
  }
};
