import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { createScenario } from "../../harness/scenario.ts";
import { changeFixture } from "../../fakes/d-change/changes.ts";
import { installArea, standUpBirth, vaultKey, vaultWrites } from "./fake.ts";
import { mateChat } from "./dsl.ts";

describe("C: agent selection and contextual drafts", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
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
        wire.message("stand-up-ask", "user", "Stand up development of the project.", "birth");
        wire.message("stand-up-reply", "assistant", "Development is standing up", "birth");
        wire.run("birth", "completed");
        yield* chat.then.ready("Ada");
        yield* chat.then.once("Development is standing up");
        yield* chat.then.noText("Stand up development of the project.");
        yield* chat.step(
          "the first acknowledged ask names its effective effort",
          chat.when.send("Inspect using the first effort"),
        );
        yield* chat.then.once("Inspect using the first effort");
        const first = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start"));
        expect(first).toMatchObject({ modelSelection: { model: "gpt-5.4" } });
        wire.run("first-effort", "completed");
        yield* chat.when.press("GPT-5.4 · Extra High");
        yield* chat.then.text("Extra High");
        yield* chat.when.press("High", "radio");
        yield* chat.when.key("Escape");
        yield* chat.when.send("Inspect using my selected effort");
        yield* chat.then.sent("Inspect using my selected effort");
        const sent = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start", 2));
        expect(sent).toMatchObject({
          threadId: "thread-Ada",
          modelSelection: {
            instanceId: "codex",
            model: "gpt-5.4",
            options: [{ id: "reasoningEffort", value: "high" }],
          },
        });
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
        const s = yield* createScenario([installArea]);
        yield* s.given.project("Ada", { mate: true });
        yield* s.given.project("Bea", { mate: true });
        const chat = mateChat(s);
        chat.fixture().history();
        chat.fixture().databaseCatalog();
        chat.fixture("Bea").history("Bea's conversation history");
        yield* s.given.signedIn;
        yield* chat.when.open();
        const schemaReply = chat.fixture().holdDataReply("table");
        yield* chat.when.type("Inspect @ordersdb");
        yield* chat.step(
          "select the reported database table",
          chat.when
            .mention("ordersdb.public.orders")
            .pipe(
              Effect.tapCause(() => Effect.logInfo(chat.fixture().mate.requests.map((r) => r.tag))),
            ),
        );
        yield* Effect.promise(() => schemaReply.requested());
        yield* chat.step(
          "a late schema belongs to Ada, even while Bea is open",
          Effect.gen(function* () {
            yield* chat.when.open("Bea", "Bea's conversation history");
            schemaReply.release();
            yield* chat.then.draft("");
            yield* chat.then.noText("order_id");
            yield* chat.when.returnTo();
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
        yield* chat.when.notePicture("A note I will undo");
        yield* chat.then.control("Note 1: A note I will undo. Edit it");
        yield* chat.when.shortcut("z");
        yield* chat.then.control("Note 1: A note I will undo. Edit it", "button", false);
        yield* chat.when.notePicture("Move this action beside its heading");
        yield* chat.then.control("Note 1: Move this action beside its heading. Edit it");
        yield* chat.when.press("Done");
        yield* chat.when.open("Bea", "Bea's conversation history");
        yield* chat.then.noText("layout.png");
        yield* chat.when.returnTo();
        yield* chat.then.control("Picture 1, layout.png. Opens it to crop or add notes.");
        yield* chat.when.pastePicture("second.png", "#334baf");
        yield* chat.then.control("Picture 2, second.png. Opens it to crop or add notes.");
        yield* chat.when.pasteFile("order-query.sql", "select order_id from orders;");
        yield* chat.then.composerText("order-query.sql");
        yield* chat.when.type("Inspect these pictures in this order");
        yield* chat.then.composerText("Inspect these pictures in this order");
        chat.fixture().turnRefusal = "This picture send was refused; retry it.";
        yield* chat.when.press("Send message");
        yield* chat.then.text("This picture send was refused; retry it.");
        yield* chat.then.control("Picture 1, layout.png. Opens it to crop or add notes.");
        chat.fixture().turnRefusal = null;
        yield* chat.when.press("Send message");
        const sent = yield* Effect.promise(() =>
          chat.fixture().waitForCommand("thread.turn.start", 2),
        );
        expect(sent.type).toBe("thread.turn.start");
        if (sent.type !== "thread.turn.start") throw new Error("Expected picture send");
        expect(
          sent.message.attachments
            ?.filter((attachment) => attachment.type === "image")
            .map((attachment) => attachment.name),
        ).toEqual(["layout.png", "second.png"]);
        expect(sent.message.attachments).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "file", name: "order-query.sql" }),
          ]),
        );
        expect(sent.message.text).toContain("Move this action beside its heading");
        expect(sent.message.text).toContain("Inspect these pictures in this order");
        expect(sent.message.text).toContain("ordersdb.public.orders");
        expect(sent.message.text).toContain("order_id");
        yield* chat.then.sent("Inspect these pictures in this order");
        yield* chat.when.reload("Ada", "Inspect these pictures in this order");
        yield* chat.then.text("Move this action beside its heading");
        yield* chat.then.text("order-query.sql");
        yield* chat.when.pastePicture("image-only.png", "#338f7b");
        yield* chat.when.press("Send message");
        const pictureOnly = yield* Effect.promise(() =>
          chat.fixture().waitForCommand("thread.turn.start", 3),
        );
        expect(pictureOnly).toMatchObject({
          message: { attachments: [{ name: "image-only.png" }] },
        });
        yield* chat.when.reload("Ada", "Inspect these pictures in this order");
        yield* chat.when.openLastPicture(3);
        yield* chat.then.text("image-only.png");
        yield* chat.when.key("Escape");
        chat.fixture().assets.clear();
        yield* chat.when.reload("Ada", "Inspect these pictures in this order");
        yield* chat.then.text("Image unavailable");
        yield* s.then.noExternalNetwork;
      }),
    );

    // J09 · Z07–Z09/Z34: context does not rewrite the person's durable words or become a slash prompt.
    it.effect(
      "J09: landed context stays separate from the person's message and compact event",
      () =>
        Effect.gen(function* () {
          const s = yield* createScenario([installArea]);
          const landed = yield* changeFixture(s);
          const chat = mateChat(s);
          const wire = chat.fixture();
          wire.history();
          wire.message(
            "change-link",
            "assistant",
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
          const sent = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start", 2));
          expect(sent).toMatchObject({ message: { text: "Inspect what landed" } });
          if (sent.type !== "thread.turn.start") throw new Error("Expected contextual send");
          expect((sent.agentNotes ?? []).join("\n")).toContain("STRIPE_KEY");
          expect((sent.agentNotes ?? []).join("\n")).toContain("Add the order summary");
          expect((sent.agentNotes ?? []).join("\n")).not.toContain("DISMISSED_KEY");
          expect((sent.agentNotes ?? []).join("\n")).not.toContain("<redacted>");
          yield* chat.then.once("Inspect what landed");
          yield* chat.then.control("Don't tell about STRIPE_KEY added", "button", false);
          wire.run("vault-run", "running");
          wire.tool(
            "vault-request",
            "tool.completed",
            {
              toolName: "mcp__zerops__zerops_env",
              input: {
                action: "request",
                key: "BILLING_KEY",
                project: true,
                reason: "The billing service needs its key.",
              },
              zerops: {
                toolName: "zerops_env",
                resultText: '{"requested":{"key":"BILLING_KEY","scope":"shared","sensitive":true}}',
              },
              result: { requested: { key: "BILLING_KEY", scope: "shared", sensitive: true } },
            },
            "vault-run",
            { itemType: "mcp_tool_call" },
          );
          wire.run("vault-run", "completed");
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
          const compact = yield* Effect.promise(() =>
            wire.waitForCommand("thread.turn.start", 3).catch((cause) => {
              throw new Error("Compact command missing", { cause });
            }),
          );
          expect(compact).toMatchObject({ message: { text: "/compact" } });
          if (compact.type !== "thread.turn.start") throw new Error("Expected compact command");
          expect(compact.agentNotes ?? []).toEqual([]);
          yield* chat.then.text("Condensing the context");
          wire.run("compact-run", "running");
          yield* chat.then.control("Stop generation");
          wire.activity(
            "context-compaction",
            "Context condensed",
            { requestId: compact.message.messageId },
            "compact-run",
          );
          wire.run("compact-run", "completed");
          yield* chat.then.text("Context condensed");
          yield* chat.step(
            "send the saved-key context after compact settles",
            chat.when.send("Use the key I saved"),
          );
          const followup = yield* Effect.promise(() =>
            wire.waitForCommand("thread.turn.start", 4).catch(async (cause) => {
              throw new Error(
                `After-compact command missing: ${await s.page.evaluate(() => document.body.innerText)}`,
                { cause },
              );
            }),
          );
          expect(
            (followup.type === "thread.turn.start" ? (followup.agentNotes ?? []) : []).join("\n"),
          ).toContain("BILLING_KEY");
          expect(
            (followup.type === "thread.turn.start" ? (followup.agentNotes ?? []) : []).join("\n"),
          ).not.toContain("synthetic-billing-secret");
          yield* chat.then.once("Use the key I saved");
          wire.run("after-compact", "completed");
          wire.run("queued-context", "running");
          yield* chat.when.send("Keep this queued instruction unchanged");
          yield* chat.then.control("Send now");
          vaultKey(s.drivers, "LATER_KEY", "2099-10-07T12:00:00.000Z");
          yield* chat.then.text("LATER_KEY");
          wire.run("queued-context", "completed");
          const queued = yield* Effect.promise(() => wire.waitForCommand("thread.turn.start", 5));
          expect(queued).toMatchObject({
            message: { text: "Keep this queued instruction unchanged" },
          });
          expect(
            (queued.type === "thread.turn.start" ? (queued.agentNotes ?? []) : []).join("\n"),
          ).not.toContain("LATER_KEY");
          yield* chat.then.control("Don't tell about LATER_KEY added");
          yield* chat.then.once("Keep this queued instruction unchanged");
          yield* s.then.noExternalNetwork;
        }),
    );
  });
});
