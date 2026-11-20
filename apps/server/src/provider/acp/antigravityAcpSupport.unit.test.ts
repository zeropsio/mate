import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ChatAttachment,
  type RuntimeMode,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import type * as EffectAcpSchema from "effect-acp/compat";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import {
  applyAntigravityAcpModelSelection,
  buildAntigravityAcpSpawnInput,
  buildAntigravityPrompt,
} from "./AntigravityAcpSupport.ts";

// witness: apps/server/src/provider/acp/AntigravityAcpSupport.ts | input.runtimeMode === "full-access" ? → input.runtimeMode !== "approval-required" ?
it("AP16: Antigravity starts with its own approve-everything flag only under full access; supervised, auto-accept-edits and auto start without it, so the person is asked", () => {
  const modes: ReadonlyArray<RuntimeMode> = [
    "approval-required",
    "auto-accept-edits",
    "auto",
    "full-access",
  ];
  const skipsApproval = Object.fromEntries(
    modes.map((runtimeMode) => [
      runtimeMode,
      buildAntigravityAcpSpawnInput({
        binaryPath: "agy",
        cwd: "/workspace",
        environment: {},
        runtimeMode,
      }).args.includes("--dangerously-skip-permissions"),
    ]),
  );
  expect(skipsApproval).toEqual({
    "approval-required": false,
    "auto-accept-edits": false,
    auto: false,
    "full-access": true,
  });
});

// witness: apps/server/src/provider/acp/AntigravityAcpSupport.ts | if (input.model && input.model !== ANTIGRAVITY_DEFAULT_MODEL) return input.model; → if (input.model === ANTIGRAVITY_DEFAULT_MODEL) return input.model;
it.effect(
  "AP17: An Antigravity session restores the conversation's saved model over the cold-resume default, and a model the account does not offer is refused, never replaced by a fallback",
  () =>
    Effect.gen(function* () {
      // After a cold resume agy reports its own default as the current model.
      const configOptions: ReadonlyArray<EffectAcpSchema.SessionConfigOption> = [
        {
          id: "model",
          name: "Model",
          type: "select",
          currentValue: "gemini-cold-default",
          options: [
            { value: "gemini-cold-default", name: "Cold default" },
            { value: "gemini-saved", name: "Saved" },
          ],
        },
      ];
      const selected: string[] = [];
      const runtime = {
        getConfigOptions: Effect.succeed(configOptions),
        setModel: (model: string) => Effect.sync(() => void selected.push(model)),
      };

      const restored = yield* applyAntigravityAcpModelSelection({
        runtime,
        model: "gemini-saved",
        mapError: (cause) => cause,
      });
      const refused = yield* Effect.exit(
        applyAntigravityAcpModelSelection({
          runtime,
          model: "gemini-withdrawn",
          mapError: (cause) => cause,
        }),
      );

      expect(restored).toBe("gemini-saved");
      expect(Exit.isFailure(refused)).toBe(true);
      expect(selected).toEqual(["gemini-saved"]);
    }),
);

const picture = {
  type: "image",
  id: "thread-1-picture",
  name: "screen.png",
  mimeType: "image/png",
  sizeBytes: 1,
} satisfies ChatAttachment;

const report = {
  type: "file",
  id: "thread-1-report",
  name: "report.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1,
} satisfies ChatAttachment;

// witness: apps/server/src/provider/acp/AntigravityAcpSupport.ts | const isPathOnly = attachment.type === "file" && (isPastedText || (!pdf && !textFile)); → const isPathOnly = isPastedText || (!pdf && !textFile);
it.effect(
  "AP18: An Antigravity prompt that cannot carry an attachment (a missing upload, an image over its own size limit or past the message's native budget) is refused whole, never sent without it",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sized = (attachmentsDir: string, attachment: ChatAttachment, bytes: number) =>
        Effect.gen(function* () {
          const filePath = resolveAttachmentPath({ attachmentsDir, attachment });
          expect(filePath).not.toBeNull();
          yield* fs.writeFile(filePath!, new Uint8Array());
          yield* fs.truncate(filePath!, bytes);
        });
      const prompt = (attachmentsDir: string, attachments: ReadonlyArray<ChatAttachment>) =>
        Effect.exit(
          buildAntigravityPrompt({ input: "Look at these.", attachments, attachmentsDir }),
        );

      const missingDir = yield* fs.makeTempDirectoryScoped();
      const missing = yield* prompt(missingDir, [picture]);

      const oversizedDir = yield* fs.makeTempDirectoryScoped();
      yield* sized(oversizedDir, picture, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES + 1);
      const oversized = yield* prompt(oversizedDir, [picture]);

      // The report fills the message's native budget exactly; the small picture overflows it.
      const budgetDir = yield* fs.makeTempDirectoryScoped();
      yield* sized(budgetDir, report, PROVIDER_SEND_TURN_MAX_FILE_BYTES);
      yield* sized(budgetDir, picture, 1);
      const overBudget = yield* prompt(budgetDir, [report, picture]);

      expect({
        missing: Exit.isFailure(missing),
        oversized: Exit.isFailure(oversized),
        overBudget: Exit.isFailure(overBudget),
      }).toEqual({ missing: true, oversized: true, overBudget: true });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
