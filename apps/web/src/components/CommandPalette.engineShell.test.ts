import { expect, it } from "vite-plus/test";
import * as Option from "effect/Option";
import { EnvironmentId } from "@t3tools/contracts";
import { overlayEngineShell } from "@t3tools/client-runtime/data";
import { engineRow, engineShellOfRecords } from "@t3tools/client-runtime/data/fixtures";
import { buildThreadActionItems } from "./CommandPalette.logic";
const environmentId = EnvironmentId.make("env-mate");
const source = {
  status: "live" as const,
  error: Option.none(),
  snapshot: Option.some({
    snapshotSequence: 1,
    projects: [{ id: "project-mate" }],
    threads: [],
    updatedAt: "2026-10-09T00:00:00.000Z",
  }),
} as unknown as Parameters<typeof overlayEngineShell>[0];

// Decision: keep fresh-send working; restore the guard's intent; Aleš's archive source is the one source.
it("an engine conversation archived after first paint leaves the palette and returns only when restored", () => {
  const key = { environmentId, conversationId: "fresh-thread" };
  const row = engineRow(environmentId, key.conversationId, { subject: "Deploy the API" });
  for (const archived of [false, true, false]) {
    const shell = engineShellOfRecords(
      key,
      { row, runs: [], items: [], header: { archived } },
      source,
    );
    const threads = Option.getOrThrow(shell.snapshot).threads.map((thread) => ({
      ...thread,
      environmentId,
    }));
    const items = buildThreadActionItems({
      threads,
      projectTitleById: new Map(),
      sortOrder: "updated_at",
      icon: null,
      runThread: async () => {},
    });
    expect(
      items.map((item) => item.title),
      "ASSERTION: archived engine conversations are absent from palette results",
    ).toEqual(archived ? [] : ["Deploy the API"]);
    expect(threads[0]?.archivedAt, "ASSERTION: the shell carries the engine archive state").toBe(
      archived ? new Date(row.at).toISOString() : null,
    );
  }
});

it("a fresh engine conversation keeps its real subject and agent without duplicating a V1 shell", () => {
  const row = engineRow(environmentId, "fresh-thread", { subject: "Deploy the API" });
  const first = overlayEngineShell(source, [row]);
  const again = overlayEngineShell(first, [row]);
  const threads = Option.getOrThrow(again.snapshot).threads;
  expect(threads).toHaveLength(1);
  expect(threads[0]).toMatchObject({
    title: "Deploy the API",
    modelSelection: { instanceId: row.agent?.instanceId },
  });
  expect(threads[0]?.crew).toBeUndefined();
});

it("a fresh engine shell takes the real subject when it arrives after the empty draft", () => {
  for (const subject of [null, "Investigate the installation"]) {
    const shell = overlayEngineShell(source, [
      engineRow(environmentId, "fresh-thread", { subject }),
    ]);
    expect(Option.getOrThrow(shell.snapshot).threads[0]?.title).toBe(subject ?? "New thread");
  }
});

it("an older engine row cannot unarchive a shell whose archive state is already known", () => {
  const archivedAt = "2026-10-08T10:00:00.000Z";
  const first = overlayEngineShell(source, [engineRow(environmentId, "archived-thread")]);
  const known = {
    ...first,
    snapshot: Option.map(first.snapshot, (snapshot) => ({
      ...snapshot,
      threads: snapshot.threads.map((thread) => ({ ...thread, archivedAt })),
    })),
  };
  const overlaid = overlayEngineShell(known, [engineRow(environmentId, "archived-thread")]);
  expect(Option.getOrThrow(overlaid.snapshot).threads[0]?.archivedAt).toBe(archivedAt);
});
