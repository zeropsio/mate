// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, afterEach, beforeEach, describe, it } from "vite-plus/test";

import { checkOrUpdateGolden, describeFirstDivergence, expectedPathFor } from "./goldenCheck.ts";

describe("goldenCheck", () => {
  let dir: string;
  let previousUpdateFlag: string | undefined;

  beforeEach(() => {
    dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "spi-golden-test-"));
    previousUpdateFlag = process.env.SPI_UPDATE_GOLDENS;
    delete process.env.SPI_UPDATE_GOLDENS;
  });

  afterEach(() => {
    NodeFS.rmSync(dir, { recursive: true, force: true });
    if (previousUpdateFlag === undefined) {
      delete process.env.SPI_UPDATE_GOLDENS;
    } else {
      process.env.SPI_UPDATE_GOLDENS = previousUpdateFlag;
    }
  });

  it("throws naming the missing file when no golden exists and updates are off", () => {
    assert.throws(() => checkOrUpdateGolden(dir, "missing", []), /SPI_UPDATE_GOLDENS/);
  });

  it("writes the golden and reports updated=true when SPI_UPDATE_GOLDENS=1", () => {
    process.env.SPI_UPDATE_GOLDENS = "1";
    const actual = [{ eventId: "evt-0", type: "session.started" }];

    const result = checkOrUpdateGolden(dir, "new-fixture", actual);

    assert.equal(result.updated, true);
    assert.deepEqual(result.expected, actual);
    const onDisk = JSON.parse(NodeFS.readFileSync(expectedPathFor(dir, "new-fixture"), "utf8"));
    assert.deepEqual(onDisk, actual);
  });

  it("reads back the checked-in golden without touching the file when updates are off", () => {
    const expected = [{ eventId: "evt-0", type: "session.started" }];
    NodeFS.writeFileSync(
      expectedPathFor(dir, "existing"),
      `${JSON.stringify(expected, null, 2)}\n`,
      "utf8",
    );

    const result = checkOrUpdateGolden(dir, "existing", expected);

    assert.equal(result.updated, false);
    assert.deepEqual(result.expected, expected);
  });
});

describe("describeFirstDivergence", () => {
  it("returns undefined when actual and expected match", () => {
    const events = [{ type: "session.started" }];
    assert.isUndefined(describeFirstDivergence("driver/name", events, events));
  });

  it("names the fixture and event-count mismatch when lengths differ", () => {
    const message = describeFirstDivergence(
      "claude/ask-user-question",
      [{ type: "a" }, { type: "b" }],
      [{ type: "a" }],
    );
    assert.match(message ?? "", /claude\/ask-user-question/);
    assert.match(message ?? "", /actual 2/);
    assert.match(message ?? "", /expected 1/);
  });

  it("names the fixture and the first differing event index/type", () => {
    const message = describeFirstDivergence(
      "codex/multi-agent-wire",
      [{ type: "a" }, { type: "changed" }],
      [{ type: "a" }, { type: "b" }],
    );
    assert.match(message ?? "", /codex\/multi-agent-wire/);
    assert.match(message ?? "", /index 1/);
    assert.match(message ?? "", /actual=changed/);
    assert.match(message ?? "", /expected=b/);
  });
});
