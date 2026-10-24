// @effect-diagnostics nodeBuiltinImport:off - reads and hashes the checked-in fixture bytes.
/**
 * zcp's monorepo contract fixtures (zcp `docs/spec-mate.md` §2.8a.7), decoded by Mate's
 * consumers. The copy in `fixtures/zcp/` is written only by `scripts/sync-zcp-fixtures.ts`;
 * `SOURCE.json` names the zcp commit and every file's sha256, so a hand edit fails here.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import { ZeropsStateEnvelope } from "@t3tools/contracts";
import { HqChange } from "@t3tools/shared/hqChanges";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsCardSource } from "./cards/decode.ts";
import { decodeZeropsCard } from "./cards/payloads.ts";
import { buildDevServerFields } from "./model/builders/devServer.ts";
import { flowChange } from "./projectFlow.ts";
import { workspaceChip } from "./workspaceChip.ts";

const dir = new URL("./fixtures/zcp/", import.meta.url);
const raw = (name: string) => NodeFS.readFileSync(new URL(name, dir));
const json = (name: string): Record<string, unknown> => JSON.parse(raw(name).toString("utf8"));
const decodeEnvelope = Schema.decodeUnknownSync(ZeropsStateEnvelope);

describe("zcp contract fixtures", () => {
  it("are byte copies of the zcp commit SOURCE.json names", () => {
    const source = json("SOURCE.json") as {
      zcpCommit: string;
      files: Record<string, string>;
    };
    expect(source.zcpCommit).toMatch(/^[0-9a-f]{40}$/);
    const copies = NodeFS.readdirSync(dir)
      .filter((name) => name.endsWith(".json") && name !== "SOURCE.json")
      .toSorted();
    expect(copies).toEqual(Object.keys(source.files).toSorted());
    for (const name of copies) {
      expect(NodeCrypto.createHash("sha256").update(raw(name)).digest("hex"), name).toBe(
        source.files[name],
      );
    }
  });

  it("decodes today's single-pair envelope to exactly the snapshots zcp sent", () => {
    const today = json("envelope.single-pair.today.json");
    const decoded = decodeEnvelope(today);
    expect(decoded.services).toEqual(today.services);
    expect(decoded.services.map((service) => [service.stages, service.devServers])).toEqual([
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("decodes today's single-pair envelope with its stage and setups", () => {
    const [dev, stage] = decodeEnvelope(json("envelope.single-pair.today.json")).services;
    expect([dev?.hostname, dev?.stageHostname, dev?.setupName, dev?.stageSetupName]).toEqual([
      "appdev",
      "appstage",
      "dev",
      "prod",
    ]);
    expect([stage?.hostname, stage?.setupName]).toEqual(["appstage", "prod"]);
  });

  it("still decodes every envelope that carries stages and dev servers", () => {
    for (const name of ["envelope.single-pair.json", "envelope.three-parts.json"]) {
      const decoded = decodeEnvelope(json(name));
      expect(decoded.services).toEqual(json(name).services);
    }
  });

  it("names one stage and one dev server under the hostname for a single pair", () => {
    const [dev] = decodeEnvelope(json("envelope.single-pair.json")).services;
    expect(dev?.stages).toEqual([{ hostname: "appstage", setup: "prod" }]);
    expect(dev?.devServers?.map((server) => [server.name, server.port, server.status])).toEqual([
      ["appdev", 3000, "running"],
    ]);
  });

  it("carries every preview and every dev server of a three-part app", () => {
    const [dev] = decodeEnvelope(json("envelope.three-parts.json")).services;
    expect(dev?.stages).toEqual([
      { hostname: "webstage", setup: "web" },
      { hostname: "apistage", setup: "api" },
      { hostname: "workerstage", setup: "worker" },
    ]);
    expect(
      dev?.devServers?.map((server) => [server.name, server.port, server.status, server.readAt]),
    ).toEqual([
      ["web", 3000, "running", "2026-10-14T21:04:00Z"],
      ["api", 8080, "running", "2026-10-14T21:04:00Z"],
      ["worker", undefined, "crashed", "2026-10-14T21:04:00Z"],
    ]);
    expect(dev?.devServers?.map((server) => [server.url, server.verify, server.lastExit])).toEqual([
      [
        "https://appdev-1df2-3000.prg1.zerops.app",
        { ok: true, httpStatus: 200, at: "2026-10-14T21:04:00Z" },
        undefined,
      ],
      [
        "https://appdev-1df2-8080.prg1.zerops.app",
        { ok: true, httpStatus: 200, at: "2026-10-14T21:04:00Z" },
        undefined,
      ],
      [undefined, undefined, { code: 1, at: "2026-10-14T21:03:10Z" }],
    ]);
  });

  it("reads the dev servers a zerops_dev_server result's envelope carries", () => {
    const devServersOf = (name: string) =>
      decodeEnvelope(json(name).envelope).services[0]?.devServers?.map((server) => [
        server.name,
        server.status,
      ]);
    expect(devServersOf("dev-server.one-server.json")).toEqual([["appdev", "running"]]);
    expect(devServersOf("dev-server.three-servers-one-crashed.json")).toEqual([
      ["web", "running"],
      ["api", "running"],
      ["worker", "crashed"],
    ]);
  });

  it("draws today's dev-server card from both dev-server results", () => {
    const card = (name: string) =>
      decodeZeropsCard(
        readZeropsCardSource(
          { toolName: "zerops_dev_server", resultText: raw(name).toString("utf8") },
          { failed: false },
        ),
      );
    expect(card("dev-server.one-server.json")).toMatchObject({
      kind: "devServer",
      action: "status",
      hostname: "appdev",
      running: true,
      port: 3000,
    });
    expect(card("dev-server.three-servers-one-crashed.json")).toMatchObject({
      kind: "devServer",
      hostname: "appdev",
      running: false,
      reason: "crashed",
    });
  });

  describe("the dev-server card", () => {
    const fields = (name: string) =>
      buildDevServerFields({
        id: "c1",
        turnId: "t1",
        toolName: "zerops_dev_server",
        input: { hostname: "appdev", action: "status" },
        status: "completed",
        resultText: raw(name).toString("utf8"),
        truncated: false,
        startedAt: "2026-10-14T21:03:50.000Z",
        anchorActivityId: "a1",
        settledAt: "2026-10-14T21:04:00.000Z",
        rowIds: new Set(["a1"]),
        agentInternal: false,
      });
    /** `21:04`, in the reader's own clock. */
    const clock = (iso: string) =>
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(Date.parse(iso));

    it("The dev-server card shows one row per named server with its last known state and when it was read", () => {
      const card = fields("dev-server.three-servers-one-crashed.json");
      const read = clock("2026-10-14T21:04:00Z");
      expect(
        card.steps.map(({ label, state, stateLabel, note }) => [label, state, stateLabel, note]),
      ).toEqual([
        ["web :3000", "done", "Running", `read ${read}`],
        ["api :8080", "done", "Running", `read ${read}`],
        [
          "worker",
          "failed",
          "Crashed",
          `exit 1 at ${clock("2026-10-14T21:03:10Z")} · read ${read}`,
        ],
      ]);
      expect(card.links).toEqual([
        { label: "web :3000", url: "https://appdev-1df2-3000.prg1.zerops.app" },
        { label: "api :8080", url: "https://appdev-1df2-8080.prg1.zerops.app" },
      ]);
    });

    it("A one-part app's dev-server card is today's: one step, no server name, no link of its own", () => {
      const card = fields("dev-server.one-server.json");
      expect(
        card.steps.map(({ label, state, stateLabel, note }) => [label, state, stateLabel, note]),
      ).toEqual([["Health check", "done", "Done", "HTTP 200"]]);
      expect(card.links).toEqual([]);
      expect(card.kicker).toBe("Dev server · appdev");
    });
  });

  it("reads what a lease status read of each lease's checkout, a fact it did not read left out", () => {
    const sent = json("envelope.lease-status.json") as { leases: ReadonlyArray<unknown> };
    const [read, unread] = decodeEnvelope(sent).leases ?? [];
    expect([read, unread]).toEqual(sent.leases);
    expect(read?.activity).toEqual({
      lastChangeAt: "2026-10-23T19:12:40Z",
      acquiredAt: "2026-10-23T18:00:00Z",
      readAt: "2026-10-23T20:04:00Z",
    });
    expect(read?.unsaved).toEqual({
      files: [" M src/App.tsx", "?? notes.txt"],
      fileCount: 2,
      unpushedCommits: 2,
    });
    expect(unread?.activity).not.toHaveProperty("lastChangeAt");
    expect(unread).not.toHaveProperty("unsaved");
  });

  it("draws the workspace chip from a lease status, never idle while its preview was not observed", () => {
    const [read, unread] = decodeEnvelope(json("envelope.lease-status.json")).leases ?? [];
    const chip = (lease: typeof read, at: string) =>
      workspaceChip({ lease, lastTurn: null, now: Date.parse(at) });
    expect(chip(read, "2026-10-23T20:04:00Z")).toEqual({
      words: "workspace · last active 51 min ago · 2 unpushed · 2 uncommitted",
      idle: false,
    });
    expect(chip(read, "2026-10-27T20:04:00Z")?.idle).toBe(false);
    expect(chip(unread, "2026-10-27T20:04:00Z")).toEqual({
      words: "workspace · last active 4 d ago",
      idle: false,
    });
  });

  it("reads a receipt whose web preview is older than the change head", () => {
    const pull = flowChange(
      Schema.decodeUnknownSync(HqChange)(json("hq-change.receipt.json")),
      "https://hq.example",
    );
    const parts = pull.receipt?.parts ?? [];
    expect(parts.map((part) => [part.setup, part.deploy])).toEqual([
      ["web", "ok"],
      ["api", "ok"],
      ["worker", "failed"],
    ]);
    expect(parts[0]?.deployedCommit).toBe("a1b2c3d4e5f60718293a4b5c6d7e8f9012345678");
    expect(parts[0]?.deployedCommit).not.toBe(pull.headSha);
    expect(parts[1]?.deployedCommit).toBeUndefined();
  });
});
