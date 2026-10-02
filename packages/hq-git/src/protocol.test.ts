import { describe, expect, it } from "@effect/vitest";
import { HttpError, pkt, readPush, refusalReport } from "./protocol.ts";

const command = (ref = "refs/heads/mate/alice/1", shaLength = 40) =>
  `${"0".repeat(shaLength)} ${"1".repeat(shaLength)} ${ref}`;
async function* bytes(buffer: Buffer, size = 1) {
  for (let offset = 0; offset < buffer.length; offset += size)
    yield buffer.subarray(offset, offset + size);
}

describe("receive command framing", () => {
  it.each([1, 2, 4, 23, 65_536])("replays the exact stream across chunk size %s", async (size) => {
    const body = Buffer.concat([
      pkt(`${command()}\0report-status side-band-64k\n`),
      Buffer.from("0000PACKremaining-binary\0\xff"),
    ]);
    const input = bytes(body, size);
    const parsed = await readPush(input);
    const rest: Buffer[] = [];
    for await (const chunk of input) rest.push(chunk);
    expect(Buffer.concat([parsed.replay, ...rest])).toEqual(body);
    expect(parsed.updates).toEqual([
      { oldSha: "0".repeat(40), newSha: "1".repeat(40), ref: "refs/heads/mate/alice/1" },
    ]);
    expect(parsed.capabilities).toEqual(["report-status", "side-band-64k"]);
  });

  it("accepts shallow preambles and SHA256 object ids", async () => {
    const body = Buffer.concat([
      pkt(`shallow ${"2".repeat(64)}\n`),
      pkt(`${command(undefined, 64)}\0report-status-v2\n`),
      Buffer.from("0000"),
    ]);
    expect((await readPush(bytes(body))).updates[0]?.newSha).toBe("1".repeat(64));
  });

  it.each([
    Buffer.from("0001"),
    Buffer.from("zzzz"),
    Buffer.from("ffff"),
    pkt("push-cert"),
    pkt(`${command()}\0push-options`),
    pkt(`${command()}\0report-status\0extra`),
    pkt(`${"0".repeat(40)} ${"1".repeat(64)} refs/heads/main`),
    Buffer.concat([pkt(command()), pkt(command()), Buffer.from("0000")]),
    Buffer.concat([
      pkt(command()),
      pkt(`${command("refs/heads/other")}\0report-status`),
      Buffer.from("0000"),
    ]),
    Buffer.concat([pkt(Buffer.from([255])), Buffer.from("0000")]),
  ])("rejects malformed or unsupported framing %j", async (body) => {
    await expect(readPush(bytes(body))).rejects.toBeInstanceOf(HttpError);
  });

  it("bounds the aggregate command list before authorization", async () => {
    const commands = Array.from({ length: 180 }, (_, i) =>
      pkt(command(`refs/heads/${i}-${"a".repeat(6000)}`)),
    );
    await expect(
      readPush(bytes(Buffer.concat([...commands, Buffer.from("0000")]), 65_536)),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("reports a whole-push refusal and sanitizes port reasons", () => {
    const updates = ["refs/heads/main", "refs/heads/topic"].map((ref) => ({
      ref,
      oldSha: "0".repeat(40),
      newSha: "1".repeat(40),
    }));
    const report = refusalReport(
      updates,
      [{ allowed: false, reason: "read_only\nng injected\0" }, { allowed: true }],
      ["report-status"],
    ).toString();
    expect(report).toContain("ng refs/heads/main read_only ng injected \n");
    expect(report).toContain("ng refs/heads/topic other_ref_refused\n");
    expect(report).not.toContain("\nng injected");
  });
});
