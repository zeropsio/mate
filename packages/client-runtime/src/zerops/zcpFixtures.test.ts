// @effect-diagnostics nodeBuiltinImport:off - reads and hashes the checked-in fixture bytes.
/**
 * zcp's monorepo contract fixtures (zcp `docs/spec-mate.md` §2.8a.7), decoded by Mate's
 * consumers. The copy in `fixtures/zcp/` is written only by `scripts/sync-zcp-fixtures.ts`;
 * `SOURCE.json` names the zcp commit and every file's sha256, so a hand edit fails here.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";

import { ZeropsStateEnvelope } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { readZeropsCardSource } from "./cards/decode.ts";
import { decodeZeropsCard } from "./cards/payloads.ts";

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

  it("reads a receipt whose web preview is older than the change head", () => {
    const change = json("hq-change.receipt.json") as {
      head: string;
      receipt: { parts: ReadonlyArray<{ setup: string; deploy: string; deployedCommit?: string }> };
    };
    expect(change.receipt.parts.map((part) => [part.setup, part.deploy])).toEqual([
      ["web", "ok"],
      ["api", "ok"],
      ["worker", "failed"],
    ]);
    expect(change.receipt.parts[0]?.deployedCommit).not.toBe(change.head);
    expect(change.receipt.parts[1]?.deployedCommit).toBeUndefined();
  });
});
