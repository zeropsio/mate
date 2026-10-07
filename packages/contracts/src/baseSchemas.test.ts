import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import * as BaseSchemas from "./baseSchemas.ts";
import {
  ForwardCompatibleArray,
  ForwardCompatibleUnion,
  ForwardCompatibleUnionArray,
  isUnknownUnionMember,
  TrimmedNonEmptyString,
  UnknownUnionMember,
} from "./baseSchemas.ts";

const at = "2026-10-05T00:00:00.000Z";
const Shape = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("circle"), radius: Schema.Number, at: Schema.DateTimeUtc }),
  Schema.Struct({ kind: Schema.Literal("square"), side: Schema.Number }),
]);
const members = Shape.members;
/** How clients decode: the JSON wire codec over the runtime schema. */
const fromWire = <S extends Schema.Top>(schema: S) =>
  Schema.decodeUnknownSync(Schema.toCodecJson(schema) as never) as (value: unknown) => S["Type"];

describe("ForwardCompatibleArray", () => {
  it("decodes elements through their own codec and drops ones it cannot read", () => {
    const decoded = fromWire(ForwardCompatibleArray(Shape))([
      { kind: "circle", radius: 1, at },
      { kind: "triangle" },
      { kind: "square", side: "wide" },
    ]);
    expect(decoded).toHaveLength(1);
    expect(DateTime.isDateTime((decoded[0] as { at: unknown }).at)).toBe(true);
  });

  it("applies decoding defaults instead of failing", () => {
    const WithDefault = Schema.Struct({
      name: Schema.String,
      count: Schema.optionalKey(Schema.Number).pipe(
        Schema.withDecodingDefaultKey(Effect.succeed(7)),
      ),
    });
    expect(Schema.decodeUnknownSync(ForwardCompatibleArray(WithDefault))([{ name: "a" }])).toEqual([
      { name: "a", count: 7 },
    ]);
  });

  it("sends an element it cannot encode as a hole instead of failing the array", () => {
    const Named = ForwardCompatibleArray(Schema.Struct({ name: TrimmedNonEmptyString }));
    const wire = JSON.parse(
      JSON.stringify(
        Schema.encodeUnknownSync(Schema.toCodecJson(Named))([
          { name: "a" },
          { name: " " },
          { name: "b" },
        ]),
      ),
    );
    expect(wire).toEqual([{ name: "a" }, null, { name: "b" }]);
    expect(fromWire(Named)(wire)).toEqual([{ name: "a" }, { name: "b" }]);
  });
});

describe("ForwardCompatibleUnion", () => {
  const decode = fromWire(ForwardCompatibleUnion(members, "kind"));

  it("decodes a member from a newer server as unknown", () => {
    const decoded = decode({ kind: "triangle", corners: 3 });
    expect(isUnknownUnionMember(decoded)).toBe(true);
    expect(decoded).toEqual(new UnknownUnionMember("kind", "triangle"));
  });

  it("decodes known members in full, transformations included", () => {
    const decoded = decode({ kind: "circle", radius: 1, at });
    expect(isUnknownUnionMember(decoded)).toBe(false);
    expect(DateTime.isDateTime((decoded as { at: unknown }).at)).toBe(true);
  });

  it("still fails a known member whose payload is broken", () => {
    expect(() => decode({ kind: "square", side: "wide" })).toThrow();
  });

  it("refuses to encode an unknown member", () => {
    const encode = Schema.encodeSync(ForwardCompatibleUnion(members, "kind") as never);
    expect(() => encode(new UnknownUnionMember("kind", "triangle") as never)).toThrow();
  });
});

describe("ForwardCompatibleUnionArray", () => {
  it("keeps a known member however its fields are named", () => {
    const Flagged = Schema.Struct({
      kind: Schema.Literal("flag"),
      _unknown: Schema.Literal(true),
      tag: Schema.String,
      value: Schema.String,
    });
    const flag = { kind: "flag", _unknown: true, tag: "kind", value: "x" };
    expect(fromWire(ForwardCompatibleUnionArray([Flagged], "kind"))([flag])).toEqual([flag]);
  });

  const decode = fromWire(ForwardCompatibleUnionArray(members, "kind"));

  it("drops members a newer server added and keeps the rest", () => {
    const decoded = decode([
      { kind: "triangle" },
      { kind: "circle", radius: 1, at },
      { kind: "square", side: 2 },
    ]);
    expect(decoded.map((shape) => shape.kind)).toEqual(["circle", "square"]);
  });

  it("fails when a known member is broken, so real bugs stay visible", () => {
    expect(() => decode([{ kind: "square", side: "wide" }])).toThrow();
  });

  it("encodes as a plain array", () => {
    const encode = Schema.encodeSync(
      Schema.toCodecJson(ForwardCompatibleUnionArray(members, "kind")),
    );
    const square = { kind: "square" as const, side: 2 };
    expect(encode([square])).toEqual([square]);
  });
});

describe("trimmed non-empty strings", () => {
  const entityIds = [
    "ThreadId",
    "ProjectId",
    "EnvironmentId",
    "CommandId",
    "EventId",
    "MessageId",
    "TurnId",
    "AuthSessionId",
    "ProviderItemId",
    "RuntimeSessionId",
    "RuntimeItemId",
    "RuntimeRequestId",
    "RuntimeTaskId",
    "ApprovalRequestId",
    "CheckpointRef",
  ] as const;
  const schemas = [
    ["TrimmedNonEmptyString", TrimmedNonEmptyString],
    ...entityIds.map((name) => [name, BaseSchemas[name]] as const),
  ] as const;

  // Every kind of whitespace `trim()` removes, around ordinary values and alone.
  const whitespace = [" ", "\t", "\n", "\r\n", "\v", "\f", "\u00a0", "\u2028", "\u3000", "\ufeff"];
  const inputs = [
    "thread-1",
    "a b",
    ...whitespace.map((space) => `${space}id${space}`),
    ...whitespace.map((space) => `${space}${space}`),
    whitespace.join(""),
    "",
  ];

  for (const [name, schema] of schemas) {
    const make = schema.makeOption;
    const encode = Schema.encodeUnknownExit(schema);
    const decode = Schema.decodeExit(schema);

    it.each(inputs)(
      `${name}: whatever make accepts of %j encodes to something that decodes back`,
      (input) => {
        const made = make(input);
        if (made._tag === "None") {
          expect(input.trim()).toBe("");
          return;
        }
        const encoded = encode(made.value);
        expect(encoded).toStrictEqual(Exit.succeed(input.trim()));
        expect(decode(input.trim())).toStrictEqual(Exit.succeed(input.trim()));
      },
    );

    it.each(inputs)(`${name}: decoding then encoding %j is stable`, (input) => {
      const decoded = decode(input);
      if (Exit.isFailure(decoded)) {
        expect(input.trim()).toBe("");
        expect(Exit.isFailure(encode(input))).toBe(true);
        return;
      }
      expect(decoded.value).toBe(input.trim());
      expect(encode(decoded.value)).toStrictEqual(Exit.succeed(decoded.value));
    });
  }

  const isThreadId = Schema.is(BaseSchemas.ThreadId);
  const encodeThreadId = Schema.encodeUnknownExit(BaseSchemas.ThreadId);
  const decodeThreadId = Schema.decodeExit(BaseSchemas.ThreadId);

  it("rejects whitespace-only values everywhere", () => {
    for (const value of [" ", "\t\n", "\u00a0\u3000"]) {
      expect(() => BaseSchemas.ThreadId.make(value)).toThrow();
      expect(isThreadId(value)).toBe(false);
      expect(Exit.isFailure(encodeThreadId(value))).toBe(true);
      expect(Exit.isFailure(decodeThreadId(value))).toBe(true);
    }
  });

  it("keeps the encoded form and JSON Schema of valid values", () => {
    expect(encodeThreadId(BaseSchemas.ThreadId.make("thread-1"))).toStrictEqual(
      Exit.succeed("thread-1"),
    );
    expect(encodeThreadId("  a b  ")).toStrictEqual(Exit.succeed("a b"));
    expect(Schema.toJsonSchemaDocument(Schema.toType(BaseSchemas.ThreadId)).schema).toEqual({
      type: "string",
      minLength: 1,
    });
  });
});
