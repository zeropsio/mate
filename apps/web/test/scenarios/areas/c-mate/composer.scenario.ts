// @effect-diagnostics nodeBuiltinImport:off -- controls real attachment bytes in a disposable Mate.
import {
  AttachmentCreateUploadUrlResult,
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
} from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { DataConsoleSpawn } from "../../../../../server/src/zerops/ZeropsDataConsole.ts";
import { ordersConsole } from "../../fakes/zcpConsole.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { deadline } from "../../harness/http.ts";
import { createScenario } from "../../harness/scenario.ts";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { installArea, standUpBirth, vaultKey, vaultWrites } from "./fake.ts";
import { mateChat } from "./dsl.ts";

const decodeUploadReceipt = Schema.decodeUnknownEffect(
  Schema.Struct({
    exit: Schema.Struct({
      _tag: Schema.Literal("Success"),
      value: AttachmentCreateUploadUrlResult,
    }),
  }),
);

describe("C: agent selection and contextual drafts", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // What waits for review moved from the composer to the conversation's header (the owner,
    // 2026-10-13: "add it somewhere to the app bar in detail"): the same pill for the Mate's owner
    // and for a colleague reading along, with Review for anyone who may review.
    it.effect(
      "a Mate's change waiting for a review stands in its conversation's header, for its owner and a colleague reading along, and opens from there",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([], { mate: "real" });
          yield* changeFixture(s);
          s.given.person("dev", { role: "Developer", grants: { Ada: "BASIC_USER" } });
          const chat = mateChat(s);
          yield* s.given.signedIn;
          yield* s.when.menu.opensMate("Ada");
          yield* s.then.conversation.appears;
          yield* s.drivers.realMates
            .get("Ada")!
            .provider.turn([{ kind: "say", text: "The order summary is ready for review" }]);
          yield* s.when.conversation.sends("Add the order summary to the shop");
          yield* s.then.conversation.showsMessage("The order summary is ready for review");
          const openHeaderReview = (page: typeof s.page) =>
            Effect.promise(async () => {
              const header = page.locator(
                '[class~="@container/header-actions"] button[aria-label="Review Add the order summary"]',
              );
              expect(
                await page.$eval(
                  '[class~="@container/header-actions"]',
                  (node) => node.textContent,
                ),
                "ASSERTION: review waits in the conversation header",
              ).toContain("Review work");
              await header.click();
            });
          yield* chat.then.text("Review work");
          yield* openHeaderReview(s.page);
          yield* chat.then.text("What it does");
          yield* chat.when.key("Escape");
          const colleague = yield* s.given.browserActor({ person: "dev" });
          yield* colleague.given.signedIn;
          const theirs = mateChat({ ...s, ...colleague });
          yield* theirs.when.openReadOnly("Ada");
          yield* theirs.then.text("Review work");
          yield* openHeaderReview(colleague.page);
          yield* theirs.then.text("What it does");
          yield* s.then.noExternalNetwork;
        }),
    );

    // Fake retained: the scripted model catalog has no effort capabilities or source for catalog/version outages.
    // J03 · Z03–Z05/Z32/Z33: the current catalog and the person's effort drive the next send.
    it.effect("J03: current model and explicit effort remain selected after send and reload", () =>
      Effect.gen(function* () {
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true, registered: false });
        yield* standUpBirth(s.drivers, "Ada");
        const chat = mateChat(s);
        const wire = chat.fixture();
        wire.effortCatalog();
        yield* s.given.signedIn;
        yield* chat.when.openReadOnly();
        yield* chat.then.text("Ada is standing up development.");
        yield* chat.then.noComposer;
        wire.history("Stand up development of the project.", "birth");
        wire.say("Development is standing up", "birth");
        wire.run("birth", "completed");
        yield* chat.then.ready("Ada");
        yield* chat.then.once("Development is standing up");
        yield* chat.then.noText("Stand up development of the project.");
        yield* chat.step(
          "the first acknowledged ask names its effective effort",
          chat.when.send("Inspect using the first effort"),
        );
        yield* chat.then.once("Inspect using the first effort");
        yield* Effect.promise(() => wire.waitForTurn("Inspect using the first effort"));
        expect(wire.engine.header.model).toBe("gpt-5.4");
        const firstRun = [...wire.engine.runs.keys()].at(-1)!;
        wire.engine.settleRun(firstRun, "completed");
        yield* chat.when.press("GPT-5.4 · Extra High");
        yield* chat.then.text("Extra High");
        yield* chat.when.press("High", "radio");
        yield* chat.when.key("Escape");
        yield* chat.when.send("Inspect using my selected effort");
        yield* chat.then.sent("Inspect using my selected effort");
        expect(
          yield* Effect.promise(() => wire.waitForTurn("Inspect using my selected effort")),
        ).toMatchObject({ effort: "high" });
        expect(wire.engine.header.agent).toMatchObject({ instanceId: "codex", model: "gpt-5.4" });
        yield* chat.when.reload("Ada", "Inspect using my selected effort");
        yield* chat.when.press("GPT-5.4 · High");
        yield* chat.then.selected("High");
        yield* chat.when.key("Escape");
        yield* chat.step(
          "a locked agent still offers its sign-in and cancellation",
          Effect.gen(function* () {
            wire.claudeLoginFacts("signed-out");
            yield* chat.when.press("GPT-5.4 · High");
            yield* chat.when.agent("Claude");
            yield* chat.then.text("This session runs on Codex");
            yield* chat.then.control("Sign in to Claude");
            yield* chat.when.press("Sign in to Claude");
            yield* chat.then.text("Sign Ada in");
            yield* chat.when.key("Escape");
            wire.claudeLoginFacts("signing-in");
            yield* chat.when.press("GPT-5.4 · High");
            yield* chat.when.agent("Claude");
            yield* chat.when.press("Cancel");
            expect(yield* Effect.promise(() => wire.waitForLoginCancel())).toMatchObject({
              agentId: "claude-code",
            });
            wire.claudeLoginFacts("ready");
            yield* chat.then.control("Sign in to Claude", "button", false);
            yield* chat.then.disabledControl(
              "Claude can't continue a session another agent started. Start a new session to use Claude.",
            );
            yield* chat.when.key("Escape");
          }),
        );
        wire.providers(
          wire.mate.config.providers.map((provider) => ({
            ...provider,
            models: [],
            status: "error",
            message: "No models are available for this provider.",
          })),
        );
        yield* chat.then.text("No models are available for this provider.");
        yield* chat.when.type("An unavailable model must not run");
        yield* chat.then.sendDisabled;
        wire.providers(
          wire.mate.config.providers.map((provider) => ({
            ...provider,
            message: "Zerops Mate needs a newer Codex version. Update Codex in this container.",
          })),
        );
        yield* chat.then.text("Update Codex in this container.");
        yield* chat.then.sendDisabled;
        yield* chat.then.noButton("Pair");
        yield* s.then.noExternalNetwork;
      }),
    );

    // J05 · Z06/Z20/Z21: an edited picture belongs to this draft and survives an acknowledged send.
    it.effect("J05: picture notes and attachment order survive send and reload", () =>
      Effect.gen(function* () {
        const schemaReply = yield* ordersConsole();
        const s = yield* createScenario([], { mate: "real" });
        yield* s.given
          .project("Ada", { mate: true })
          .pipe(Effect.provideService(DataConsoleSpawn, schemaReply.spawn));
        yield* s.given.project("Bea", { mate: true });
        const chat = mateChat(s);
        const mate = s.drivers.realMates.get("Ada")!;
        for (const name of ["Ada", "Bea"]) {
          const real = s.drivers.realMates.get(name)!;
          const conversationId = ConversationId.make(`composer-${name}`);
          yield* real.server.engine.assignAgent(conversationId, {
            instanceId: "opencode",
            driver: "opencode",
            model: "gpt-5.4",
            profile: { kind: "mate" },
          });
          yield* real.provider.turn([
            { kind: "say", text: "The existing conversation is still here" },
          ]);
          expect(
            (yield* real.server.engine.wire.send(
              {
                protocol: MATE_ENGINE_PROTOCOLS[0]!,
                conversationId,
                commandId: CommandId.make(`composer-history-${name}`),
                text: "Keep this conversation",
              },
              { subject: "scenario-person", environmentId: "scenario", epoch: 1 },
            ))._tag,
          ).toBe("Accepted");
          yield* real.provider.received;
        }
        yield* s.given.signedIn;
        yield* chat.when.openReadOnly("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.control("Stop generation", "button", false);
        yield* chat.when.type("Inspect @ordersdb");
        yield* chat.step(
          "select the reported database table",
          chat.when.mention("ordersdb.public.orders").pipe(
            Effect.tapCause(() =>
              Effect.logInfo({
                consoleRequests: schemaReply.requests,
                consoleStarts: schemaReply.starts(),
                mateRequests: mate.gate.requests.filter(
                  (request) => request.startsWith("RPC ") && !request.startsWith("RPC failed"),
                ),
              }),
            ),
          ),
        );
        yield* Effect.promise(() => schemaReply.requested());
        yield* chat.step(
          "a late schema belongs to Ada, even while Bea is open",
          Effect.gen(function* () {
            yield* chat.when.openReadOnly("Bea");
            yield* chat.then.text("The existing conversation is still here");
            schemaReply.release();
            yield* chat.then.draft("");
            yield* chat.then.noText("order_id");
            yield* chat.when.openReadOnly("Ada");
            yield* chat.then.text("The existing conversation is still here");
          }),
        );
        yield* chat.when.pastePicture("layout.png");
        yield* chat.when.press("Picture 1, layout.png. Opens it to crop or add notes.");
        yield* chat.when.press("Crop");
        yield* chat.then.control("Reset");
        yield* chat.when.key("Escape");
        yield* chat.then.control("Reset", "button", false);
        yield* chat.when.key("c");
        yield* chat.when.cropPicture();
        yield* chat.then.text("160 × 200");
        yield* chat.when.key("Enter");
        yield* chat.then.text("Sends");
        yield* chat.when.shortcut("z");
        yield* chat.then.text("320 × 200");
        yield* chat.when.notePicture("Move this action beside its heading");
        yield* chat.then.control("Note 1: Move this action beside its heading. Edit it");
        yield* chat.when.press("Done");
        yield* chat.when.openReadOnly("Bea");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.noText("layout.png");
        yield* chat.when.openReadOnly("Ada");
        yield* chat.then.text("The existing conversation is still here");
        yield* chat.then.control("Picture 1, layout.png. Opens it to crop or add notes.");
        const secondUpload = mate.gate.answered((tag) => tag === "attachments.createUploadUrl");
        yield* chat.when.pastePicture("second.png", "#334baf");
        const second = yield* decodeUploadReceipt(
          yield* Effect.promise(() => deadline(secondUpload, "second picture upload identity")),
        );

        yield* chat.then.control("Picture 2, second.png. Opens it to crop or add notes.");
        const uploads = mate.gate.holdHttp((path) => path.includes("/api/attachments/upload/"));
        yield* chat.when.pasteFile("order-query.sql", "select order_id from orders;");
        yield* chat.then.composerText("order-query.sql");
        yield* chat.when.type("Inspect these pictures in this order");
        yield* chat.then.composerText("Inspect these pictures in this order");
        yield* Effect.promise(() => deadline(uploads.held, "stored picture upload"));
        const pending = yield* Effect.promise(async () => {
          const directory = NodePath.join(mate.server.stateDir, "attachments");
          const path = NodePath.join(directory, `${second.exit.value.attachmentId}.png`);
          const bytes = await NodeFSP.readFile(path);
          await NodeFSP.rm(path);
          return { path, bytes };
        });
        const refusal = mate.gate.answered((tag) => tag === "engine.send");
        uploads.release();
        yield* chat.when.press("Send message");
        expect(
          yield* Effect.promise(() => deadline(refusal, "refused picture send")),
        ).toMatchObject({
          exit: {
            _tag: "Success",
            value: { _tag: "Rejected", rejection: { reason: "attachment-refused" } },
          },
        });
        yield* chat.then.text("cannot be sent: attachment not found (removed or expired).");
        yield* chat.then.control("Picture 1, layout.png. Opens it to crop or add notes.");
        yield* Effect.promise(() => NodeFSP.writeFile(pending.path, pending.bytes));
        yield* mate.provider.turn([{ kind: "say", text: "Pictures received" }]);
        yield* chat.when.press("Send message");
        const native = yield* mate.provider.received;
        const sent = { text: native.input.input!, attachments: native.input.attachments! };
        expect(
          sent.attachments
            .filter((attachment) => attachment.type === "image")
            .map((attachment) => attachment.name),
        ).toEqual(["layout.png", "second.png"]);
        expect(sent.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "file", name: "order-query.sql" }),
          ]),
        );
        expect(sent.text).toContain("Move this action beside its heading");
        expect(sent.text).toContain("Inspect these pictures in this order");
        expect(sent.text).toContain("ordersdb.public.orders");
        expect(sent.text).toContain("order_id");
        // The real provider answers it: the conversation is at rest again.
        yield* chat.then.text("Pictures received");
        yield* chat.then.control("Stop generation", "button", false);
        yield* chat.then.sent("Inspect these pictures in this order");
        yield* chat.when.reload("Ada", "Inspect these pictures in this order");
        yield* chat.then.text("Move this action beside its heading");
        yield* chat.then.text("order-query.sql");
        yield* mate.provider.turn([{ kind: "say", text: "Image received" }]);
        yield* chat.when.pastePicture("image-only.png", "#338f7b");
        yield* chat.when.press("Send message");
        const pictureOnly = yield* mate.provider.received;
        expect(pictureOnly.input).toMatchObject({ attachments: [{ name: "image-only.png" }] });
        yield* chat.then.text("Image received");
        yield* chat.then.control("Stop generation", "button", false);
        yield* chat.when.reload("Ada", "Inspect these pictures in this order");
        yield* chat.when.openLastPicture(3);
        yield* chat.then.text("image-only.png");
        yield* chat.when.key("Escape");
        yield* Effect.promise(async () => {
          const directory = NodePath.join(mate.server.stateDir, "attachments");
          const pictures = (await NodeFSP.readdir(directory)).filter((name) =>
            name.endsWith(".png"),
          );
          expect(pictures.length).toBeGreaterThanOrEqual(3);
          await Promise.all(pictures.map((name) => NodeFSP.rm(NodePath.join(directory, name))));
          // Real asset reads use retained originals/previews, not the upload's old pathname.
          for (const source of ["originals", "previews/objects"]) {
            const retained = NodePath.join(mate.server.stateDir, "assets", source);
            const objects = (await NodeFSP.readdir(retained)).filter(
              (name) => !name.endsWith(".json"),
            );
            expect(
              objects.length,
              `ASSERTION: ${source} contains real picture bytes`,
            ).toBeGreaterThan(0);
            await Promise.all(objects.map((name) => NodeFSP.rm(NodePath.join(retained, name))));
          }
        });
        yield* chat.when.reload("Ada", "Inspect these pictures in this order");
        yield* chat.when.openLastPicture(3);
        yield* chat.then.text("Image no longer available");
        yield* s.then.noExternalNetwork;
      }),
    );

    // Fake retained: native Claude sign-in exists, but no source supplies this case's send-time sign-in refusal.
    // J09 · Z07–Z09/Z34: context does not rewrite the person's durable words or become a slash prompt.
    it.effect(
      "J09: landed context stays separate from the person's message and compact event",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          const landed = yield* changeFixture(s);
          const chat = mateChat(s);
          const wire = chat.fixture();
          const engine = wire.engine;
          /** The agent says `text` in a turn of its own that ends with it. */
          const say = (text: string) => {
            const run = engine.startRun(null);
            engine.item(run, { kind: "note", text, streaming: false, answer: true });
            engine.end(run);
          };
          /** The `count`th message the engine took, sent or steered: its words and its context. */
          const sent = (count: number) =>
            Effect.promise(async () => {
              const messages = () =>
                engine.applied.filter(({ op }) => op === "send" || op === "steer");
              await deadline(
                new Promise<void>((resolve) => {
                  const timer = setInterval(() => {
                    if (messages().length < count) return;
                    clearInterval(timer);
                    resolve();
                  }, 25);
                }),
                `Message ${count} the engine took`,
                8000,
              );
              const { payload } = messages()[count - 1]!;
              return {
                text: String(payload.text),
                context: ((payload.context ?? []) as ReadonlyArray<string>).join("\n"),
              };
            });
          const lastRun = () => [...engine.runs.keys()].at(-1)!;
          wire.history();
          say(
            `Review [the order change](https://hqzone.prg1-zerops.zone${landed.direct.replace("/change/", "/changes/")})`,
          );
          const vault = vaultWrites(s.drivers);
          vaultKey(s.drivers, "DISMISSED_KEY", "2026-10-07T10:00:00.000Z");
          vaultKey(s.drivers, "STRIPE_KEY", "2026-10-07T11:00:00.000Z");
          yield* s.given.signedIn;
          yield* chat.when.open();
          yield* landed.colleagueMerges;
          yield* chat.when.reload();
          yield* chat.then.text("Add the order summary");
          yield* chat.then.text("STRIPE_KEY");
          yield* chat.then.noText("<redacted>");
          yield* chat.when.press("Don't tell about DISMISSED_KEY added");
          wire.turnRefusal = "Your sign-in no longer permits this send. Sign in again.";
          yield* chat.when.send("Inspect what landed");
          yield* chat.then.text("Your sign-in no longer permits this send. Sign in again.");
          yield* chat.then.draft("Inspect what landed");
          yield* chat.then.text("STRIPE_KEY");
          yield* chat.then.noText("Inspect what landed");
          wire.turnRefusal = null;
          yield* chat.when.press("Send message");
          // The agent hears the vault's key names and the merged changes with the person's message;
          // the person's words go as they wrote them.
          const first = yield* sent(1);
          expect(first.text).toBe("Inspect what landed");
          expect(first.context).toContain("STRIPE_KEY");
          expect(first.context).toContain("Add the order summary");
          expect(first.context).not.toContain("DISMISSED_KEY");
          expect(first.context).not.toContain("<redacted>");
          yield* chat.then.once("Inspect what landed");
          yield* chat.then.control("Don't tell about STRIPE_KEY added", "button", false);
          engine.settleRun(lastRun(), "completed");
          const vaultRun = engine.startRun(null);
          engine.item(vaultRun, {
            kind: "call",
            step: "mcp",
            words: null,
            state: "done",
            endedAt: null,
            tool: { name: "zerops_env", server: "zerops" },
            shows: {
              toolName: "mcp__zerops__zerops_env",
              input: {
                action: "request",
                key: "BILLING_KEY",
                project: true,
                reason: "The billing service needs its key.",
              },
              result: { requested: { key: "BILLING_KEY", scope: "shared", sensitive: true } },
            },
            result: {
              toolName: "zerops_env",
              resultText: '{"requested":{"key":"BILLING_KEY","scope":"shared","sensitive":true}}',
            },
          });
          engine.settleRun(vaultRun, "completed");
          yield* chat.then.text("The billing service needs its key.");
          yield* chat.when.reload("Ada", "Inspect what landed");
          yield* chat.then.text("The billing service needs its key.");
          vault.refuse = true;
          yield* chat.when.fill(
            "Paste it here — it goes to the vault, not the chat",
            "synthetic-billing-secret",
          );
          yield* chat.step(
            "the refused vault save keeps the request answerable",
            chat.when.press("Put in vault"),
          );
          yield* chat.then.text("read-only");
          yield* chat.then.noText("synthetic-billing-secret");
          vault.refuse = false;
          yield* chat.when.press("Put in vault");
          yield* chat.then.text("is in the vault");
          expect(vault.writes).toEqual([
            { key: "BILLING_KEY", content: "synthetic-billing-secret" },
          ]);
          yield* chat.then.noText("synthetic-billing-secret");
          yield* chat.step(
            "dispatch compact without the queued context",
            chat.when.send("/compact"),
          );
          const compact = yield* sent(2);
          expect(compact).toEqual({ text: "/compact", context: "" });
          yield* chat.then.text("Condensing the context");
          const compactRun = lastRun();
          yield* chat.then.control("Stop generation");
          engine.item(compactRun, {
            kind: "marker",
            by: { kind: "engine" },
            marker: { kind: "compacted" },
          });
          engine.settleRun(compactRun, "completed");
          yield* chat.then.text("Context condensed");
          yield* chat.step(
            "send the saved-key context after compact settles",
            chat.when.send("Use the key I saved"),
          );
          const followup = yield* sent(3);
          expect(followup.text).toBe("Use the key I saved");
          expect(followup.context).toContain("BILLING_KEY");
          const holds = (value: unknown): boolean =>
            typeof value === "string"
              ? value.includes("synthetic-billing-secret")
              : typeof value === "object" && value !== null && Object.values(value).some(holds);
          expect(holds(engine.applied)).toBe(false);
          yield* chat.then.once("Use the key I saved");
          engine.settleRun(lastRun(), "completed");
          const working = engine.startRun(null);
          yield* chat.when.send("Keep this queued instruction unchanged");
          yield* chat.then.control("Send now");
          vaultKey(s.drivers, "LATER_KEY", "2099-10-07T12:00:00.000Z");
          yield* chat.then.text("LATER_KEY");
          engine.settleRun(working, "completed");
          const queued = yield* sent(4);
          expect(queued.text).toBe("Keep this queued instruction unchanged");
          expect(queued.context).not.toContain("LATER_KEY");
          yield* chat.then.control("Don't tell about LATER_KEY added");
          yield* chat.then.once("Keep this queued instruction unchanged");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
