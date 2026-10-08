// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { ChatAttachment } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import {
  createAttachmentId,
  createPendingAttachmentId,
  parseThreadSegmentFromAttachmentId,
  resolveAttachmentPath,
  toSafeThreadAttachmentSegment,
} from "../../attachmentStore.ts";
import {
  crewJourney,
  eventually,
  everyCopyReady,
  opened,
  turnsSent,
  type CrewWorld,
} from "./testing/crewWorld.ts";

/** A crew of a lead and a writer, applied. */
const withLead = (world: CrewWorld) =>
  Effect.gen(function* () {
    world.writeHome({
      "crew.yaml": [
        "name: Game team",
        "briefTitle: Space shooter",
        "members:",
        "  - handle: lead",
        "    displayName: Lead",
        "    kind: lead",
        "  - handle: backend",
        "    displayName: Backend",
        "    host: appdev",
        "",
      ].join("\n"),
      "jobs/lead.md": "Plan the work.\n",
    });
    yield* world.press({ _tag: "apply" });
    yield* eventually(Effect.map(world.snapshot, everyCopyReady));
  });

const attachmentsDir = (world: CrewWorld) => world.attachmentsDir;

/** A file stored under `id`, as an upload or a sent message stores it. */
const storedFile = (world: CrewWorld, id: string, bytes = "spec"): ChatAttachment => {
  const attachment: ChatAttachment = {
    type: "file",
    id,
    name: "spec.pdf",
    mimeType: "application/pdf",
    sizeBytes: Buffer.byteLength(bytes),
  };
  const path = resolveAttachmentPath({ attachmentsDir: attachmentsDir(world), attachment })!;
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, bytes);
  return attachment;
};

const turnsOf = (world: CrewWorld, handle: string) =>
  Effect.gen(function* () {
    const chat = (yield* opened(world)).find((entry) => entry.handle === handle)?.chat;
    return (yield* turnsSent(world)).filter((turn) => turn.chat === chat);
  });

describe("a crew message's attachments", () => {
  it.live(
    "are claimed as a thread message's: stored in the crewmate's thread, there after the upload goes",
    () =>
      crewJourney((world) =>
        Effect.gen(function* () {
          yield* withLead(world);
          // The lead's message and a writer's alike.
          for (const handle of ["lead", "backend"]) {
            const upload = storedFile(world, createPendingAttachmentId(".pdf"));
            yield* world.press({
              _tag: "message",
              handle,
              text: "Read [File 1]",
              attachments: [upload],
            });
            yield* eventually(Effect.map(turnsOf(world, handle), (turns) => turns.length > 0));
            const turn = (yield* turnsOf(world, handle)).at(-1)!;
            const sent = turn.attachments[0]!;
            // The client lets its upload go once the send succeeded.
            NodeFS.rmSync(
              resolveAttachmentPath({ attachmentsDir: attachmentsDir(world), attachment: upload })!,
            );
            const stored = resolveAttachmentPath({
              attachmentsDir: attachmentsDir(world),
              attachment: sent,
            })!;
            assert.deepStrictEqual(
              [
                handle,
                sent.id === upload.id,
                parseThreadSegmentFromAttachmentId(sent.id),
                NodeFS.readFileSync(stored, "utf8"),
              ],
              [handle, false, toSafeThreadAttachmentSegment(turn.chat), "spec"],
            );
          }
        }),
      ),
  );

  it.live("are refused when one names another thread's stored attachment", () =>
    crewJourney((world) =>
      Effect.gen(function* () {
        yield* withLead(world);
        const theirs = storedFile(world, createAttachmentId("someone-elses-thread", ".pdf")!);
        const before = (yield* turnsOf(world, "lead")).length;
        const refused = yield* world
          .press({
            _tag: "message",
            handle: "lead",
            text: "Read [File 1]",
            attachments: [theirs],
          })
          .pipe(Effect.flip);
        assert.deepStrictEqual(
          [
            refused._tag,
            refused.detail?.includes("pending upload") ?? false,
            (yield* turnsOf(world, "lead")).length,
          ],
          ["CrewCommandError", true, before],
        );
      }),
    ),
  );
});
