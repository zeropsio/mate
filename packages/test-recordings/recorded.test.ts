// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- a drifted copy of a recording.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { producers, recorded, recordedIn } from "./recorded.ts";

const committed = producers(import.meta.dirname).flatMap((producer) =>
  NodeFS.readdirSync(NodePath.join(import.meta.dirname, producer))
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      producer,
      name: file.slice(0, -".json".length),
      schema: JSON.parse(
        NodeFS.readFileSync(NodePath.join(import.meta.dirname, producer, file), "utf8"),
      ).$provenance.schema,
    })),
);

// One scratch tree holds the recordings a producer could have drifted to.
const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "test-recordings-"));
afterAll(() => NodeFS.rmSync(scratch, { recursive: true, force: true }));
const signedIn = NodePath.join(import.meta.dirname, "mate-hq", "navigation-project.signed-in.json");

describe("recorded", () => {
  // witness: packages/test-recordings/recorded.ts | "navigation project:<id>": HqNavigationProject, →
  it.each(committed)(
    "$producer recording $name decodes through the schema it names",
    ({ name, schema }) => {
      expect(() => recorded(schema, name)).not.toThrow();
    },
  );

  // witness: packages/test-recordings/recorded.ts | const value = decode(recording.value); → const value = recording.value as Recorded;
  it("a recording that dropped a field its schema requires fails at load", () => {
    const drifted = JSON.parse(NodeFS.readFileSync(signedIn, "utf8"));
    delete drifted.value.signedInNow;
    NodeFS.mkdirSync(NodePath.join(scratch, "mate-hq"), { recursive: true });
    NodeFS.writeFileSync(
      NodePath.join(scratch, "mate-hq", "navigation-project.drifted.json"),
      JSON.stringify(drifted),
    );
    expect(() =>
      recordedIn(scratch)("navigation project:<id>", "navigation-project.drifted"),
    ).toThrow(/signedInNow/u);
  });

  // witness: packages/test-recordings/recorded.ts | return edit ? decode(edit(value)) : value; → return edit ? edit(value) : value;
  it("an edit its schema refuses fails at load", () => {
    expect(() =>
      recorded("navigation project:<id>", "navigation-project.signed-in", (value) => ({
        ...value,
        name: 7 as unknown as string,
      })),
    ).toThrow(/name/u);
  });

  // witness: packages/test-recordings/recorded.ts | if (named !== schema) throw → if (named === "") throw
  it("a recording read as a schema it does not name fails at load", () => {
    expect(() => recorded("scope-changed", "navigation-project.signed-in")).toThrow(
      /names schema "navigation project:<id>", not "scope-changed"/u,
    );
  });

  // witness: packages/test-recordings/recorded.ts | if (files.length !== 1) → if (files.length > 1)
  it("a name no producer recorded fails at load", () => {
    expect(() => recorded("navigation project:<id>", "navigation-project.nobody")).toThrow(
      /navigation-project\.nobody/u,
    );
  });

  // witness: packages/test-recordings/recorded.ts | return edit ? decode(edit(value)) : value; → return value;
  it("an edit changes the value the test reads", () => {
    expect(
      recorded("navigation project:<id>", "navigation-project.signed-in", (value) => ({
        ...value,
        name: "crm",
      })).name,
    ).toBe("crm");
  });
});
