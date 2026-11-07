// @effect-diagnostics nodeBuiltinImport:off -- Real producer checkout and target directories.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { syncRecordings } from "./sync-recordings.ts";

const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "sync-recordings-"));
afterAll(() => NodeFS.rmSync(scratch, { recursive: true, force: true }));

// A recording as mate-hq's recorder writes it: its own key order and spacing, kept byte for byte.
const recording = (producer: string, name: string, schema = "navigation project:<id>") =>
  `{\n  "$provenance": {\n    "producer": "${producer}",\n    "revision": "r1",\n    "via": "a.test.ts",\n    "schema": "${schema}"\n  },\n  "value": {"name":  "${name}"}\n}\n`;

const checkout = (name: string, files: Record<string, string>) => {
  const recordings = NodePath.join(scratch, name, "conformance", "recordings");
  NodeFS.mkdirSync(recordings, { recursive: true });
  for (const [file, text] of Object.entries(files))
    NodeFS.writeFileSync(NodePath.join(recordings, file), text);
  return NodePath.join(scratch, name);
};

describe("sync-recordings", () => {
  // witness: scripts/sync-recordings.ts | for (const name of removed) NodeFS.rmSync(NodePath.join(directory, name)); →
  it("copies a producer's recordings byte for byte into its directory and removes the ones it no longer makes", () => {
    const target = NodePath.join(scratch, "copy-target");
    NodeFS.mkdirSync(NodePath.join(target, "mate-hq"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(target, "mate-hq", "gone.json"), recording("mate-hq", "x"));
    const kept = recording("mate-hq", "kept");

    const synced = syncRecordings(checkout("copy", { "kept.json": kept }), target);

    expect(synced).toEqual({
      producer: "mate-hq",
      copied: ["kept.json"],
      skipped: [],
      removed: ["gone.json"],
    });
    expect(NodeFS.readdirSync(NodePath.join(target, "mate-hq"))).toEqual(["kept.json"]);
    expect(NodeFS.readFileSync(NodePath.join(target, "mate-hq", "kept.json"), "utf8")).toBe(kept);
  });

  // witness: scripts/sync-recordings.ts | for (const name of skipped) texts.delete(name); →
  it("keeps no recording of a wire nothing here consumes", () => {
    const target = NodePath.join(scratch, "consumer-target");
    NodeFS.mkdirSync(NodePath.join(target, "mate-hq"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(target, "mate-hq", "chat-link.linked.json"),
      recording("mate-hq", "x", "POST /api/chat-links HqChatLink"),
    );
    const synced = syncRecordings(
      checkout("consumer", {
        "chat-link.linked.json": recording("mate-hq", "linked", "POST /api/chat-links HqChatLink"),
        "kept.json": recording("mate-hq", "kept"),
      }),
      target,
    );
    expect(synced).toEqual({
      producer: "mate-hq",
      copied: ["kept.json"],
      skipped: ["chat-link.linked.json"],
      removed: ["chat-link.linked.json"],
    });
    expect(NodeFS.readdirSync(NodePath.join(target, "mate-hq"))).toEqual(["kept.json"]);
  });

  // witness: scripts/sync-recordings.ts | if (named.size !== 1) → if (named.size === 0)
  it("refuses a checkout whose recordings name two producers", () => {
    const target = NodePath.join(scratch, "mixed-target");
    const mixed = checkout("mixed", {
      "a.json": recording("mate-hq", "a"),
      "b.json": recording("zerops", "b"),
    });
    expect(() => syncRecordings(mixed, target)).toThrow(/mate-hq, zerops/u);
    expect(NodeFS.existsSync(target)).toBe(false);
  });
});
