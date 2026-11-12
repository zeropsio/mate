/**
 * The operator's command HQ sends down the Mate link (`LinkCommandDown`; mate-hq `spec/protocol.md`):
 * run through `runExecCommand`, the one way a command runs in the container, at most once per id in
 * this server process, and answered `command-result` fitted to the link's frame bound. Neither the
 * update admission that fences the web's `exec.run` nor the Mate's automation gates it: a stuck
 * update is one reason an operator sends one.
 *
 * @module zerops/zeropsLinkCommand
 */
import type { ExecRunResult } from "@t3tools/contracts";
import {
  type LinkCommandDown,
  type LinkCommandResultUp,
  linkFrameBytes,
  MATE_LINK_FRAME_MAX,
} from "@t3tools/shared/mateLink";
import * as Effect from "effect/Effect";

import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { runExecCommand } from "./ExecService.ts";

/** The UTF-8 bytes `text` adds to a frame as a JSON string, its quotes left out. */
const jsonBytes = (text: string): number => linkFrameBytes(JSON.stringify(text)) - 2;

/** The longest end of `text` whose JSON form fits `budget` bytes, cut between code points. */
const keepEnd = (text: string, budget: number): string => {
  let start = text.length;
  let used = 0;
  while (start > 0) {
    let from = start - 1;
    const unit = text.charCodeAt(from);
    if (unit >= 0xdc00 && unit <= 0xdfff && from > 0) {
      const lead = text.charCodeAt(from - 1);
      if (lead >= 0xd800 && lead <= 0xdbff) from -= 1;
    }
    const cost = jsonBytes(text.slice(from, start));
    if (used + cost > budget) break;
    used += cost;
    start = from;
  }
  return text.slice(start);
};

/**
 * The `command-result` of a command that ran, within {@link MATE_LINK_FRAME_MAX}: each stream keeps
 * its end; a stream that fits in half the room leaves the rest to the other.
 */
export const fitCommandResult = (id: string, result: ExecRunResult): LinkCommandResultUp => {
  const frame = { type: "command-result", id, ran: true, ...result } as const;
  const room =
    MATE_LINK_FRAME_MAX - linkFrameBytes(JSON.stringify({ ...frame, stdout: "", stderr: "" }));
  const out = jsonBytes(result.stdout);
  const err = jsonBytes(result.stderr);
  if (out + err <= room) return frame;
  const half = Math.floor(room / 2);
  const outRoom = out <= half ? out : err <= half ? room - err : half;
  const stdout = out <= outRoom ? result.stdout : keepEnd(result.stdout, outRoom);
  const stderr = err <= room - outRoom ? result.stderr : keepEnd(result.stderr, room - outRoom);
  return {
    ...frame,
    stdout,
    stderr,
    stdoutTruncated: result.stdoutTruncated || stdout.length < result.stdout.length,
    stderrTruncated: result.stderrTruncated || stderr.length < result.stderr.length,
  };
};

/**
 * Answers each `command` HQ sends. Its id is recorded before it runs, so a repeat heard while it
 * still runs answers `duplicate` as well. One log line per command, never its arguments or output.
 */
export const makeLinkCommands = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const runner = yield* ProcessRunner.ProcessRunner;
  const heard = new Set<string>();
  return (frame: LinkCommandDown): Effect.Effect<LinkCommandResultUp> =>
    Effect.suspend(() => {
      const ran: Effect.Effect<{
        readonly answer: LinkCommandResultUp;
        readonly detail: string | undefined;
      }> = heard.has(frame.id)
        ? Effect.succeed({
            answer: { type: "command-result", id: frame.id, ran: false, reason: "duplicate" },
            detail: undefined,
          })
        : Effect.sync(() => heard.add(frame.id)).pipe(
            Effect.andThen(
              runExecCommand({
                command: frame.command,
                args: frame.args,
                ...(frame.cwd === undefined ? {} : { cwd: frame.cwd }),
                ...(frame.timeoutMs === undefined ? {} : { timeoutMs: frame.timeoutMs }),
              }),
            ),
            Effect.map((run) => ({
              answer: fitCommandResult(frame.id, run.result),
              detail: run.detail,
            })),
            Effect.catchTags({
              ExecError: (error) =>
                Effect.succeed({
                  answer: {
                    type: "command-result",
                    id: frame.id,
                    ran: false,
                    reason: error.reason,
                  } as const,
                  detail: error.detail,
                }),
            }),
            Effect.provideService(ServerConfig.ServerConfig, config),
            Effect.provideService(ProcessRunner.ProcessRunner, runner),
          );
      return ran.pipe(
        Effect.tap(({ answer, detail }) =>
          Effect.logInfo("zerops hq link: operator command", {
            id: frame.id,
            command: frame.command,
            argCount: frame.args.length,
            ...(answer.ran
              ? { exitCode: answer.exitCode, timedOut: answer.timedOut }
              : { reason: answer.reason }),
            ...(detail === undefined ? {} : { detail }),
          }),
        ),
        Effect.map(({ answer }) => answer),
      );
    });
});
