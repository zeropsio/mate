import { describe, expect, it } from "@effect/vitest";

import {
  restoreImportZoneFile,
  rewriteFile,
  transformImportZoneFile,
} from "./effect-401-codemod.ts";

const cases: ReadonlyArray<{
  readonly name: string;
  readonly path?: string;
  readonly input: string;
  readonly output: string;
}> = [
  {
    name: "an unstable area import moves to the package root",
    input: `import { HttpClient } from "effect/unstable/http";\n`,
    output: `import { HttpClient } from "effect/http";\n`,
  },
  {
    name: "a module path keeps its module under the new area",
    input: `import * as SqlClient from "effect/unstable/sql/SqlClient";\n`,
    output: `import * as SqlClient from "effect/sql/SqlClient";\n`,
  },
  {
    name: "httpapi becomes http-api",
    input: `import { HttpApiBuilder } from 'effect/unstable/httpapi/HttpApiBuilder';\n`,
    output: `import { HttpApiBuilder } from 'effect/http-api/HttpApiBuilder';\n`,
  },
  {
    name: "a dynamic import and a string in code move too",
    input: `const { Atom } = await import("effect/unstable/reactivity");\nif (source === "effect/unstable/http") {}\n`,
    output: `const { Atom } = await import("effect/reactivity");\nif (source === "effect/http") {}\n`,
  },
  {
    name: "a guard ledger fingerprint follows the import it names",
    path: "exceptions.json",
    input: `{ "fingerprint": "effect/unstable/socket/Socket" }\n`,
    output: `{ "fingerprint": "effect/socket/Socket" }\n`,
  },
  {
    name: "the escaped form inside a regular expression moves, group included",
    input: `const R = /^(?:effect\\/unstable\\/(?:http|httpapi)(?:\\/|$))/u;\nconst S = /^effect\\/unstable\\/reactivity(?:\\/|$)/u;\n`,
    output: `const R = /^(?:effect\\/(?:http|http-api)(?:\\/|$))/u;\nconst S = /^effect\\/reactivity(?:\\/|$)/u;\n`,
  },
  {
    name: "Encoding splits into the modules its members now live in",
    input: [
      `import * as Effect from "effect/Effect";`,
      `import * as Encoding from "effect/Encoding";`,
      ``,
      `const a = Encoding.encodeBase64(bytes);`,
      `const b = Encoding.decodeBase64UrlString(text);`,
      `const c = Effect.map(Encoding.encodeHex);`,
      `const d = Encoding.randomHex(16);`,
      ``,
    ].join("\n"),
    output: [
      `import * as Effect from "effect/Effect";`,
      `import * as Base64 from "effect/encoding/Base64";`,
      `import * as Base64Url from "effect/encoding/Base64Url";`,
      `import * as Hex from "effect/encoding/Hex";`,
      ``,
      `const a = Base64.encode(bytes);`,
      `const b = Base64Url.decodeString(text);`,
      `const c = Effect.map(Hex.encode);`,
      `const d = Hex.random(16);`,
      ``,
    ].join("\n"),
  },
  {
    name: "a type-only Encoding import stays type-only, under any alias",
    input: `import type * as Enc from "effect/Encoding";\ntype E = Enc.EncodingError;\n`,
    output: `import type * as EncodingError from "effect/encoding/EncodingError";\ntype E = EncodingError.EncodingError;\n`,
  },
  {
    name: "a module the file already imports is reused, not imported twice",
    input: `import * as Hex from "effect/encoding/Hex";\nimport * as Encoding from "effect/Encoding";\nHex.encode(a);\nEncoding.encodeHex(b);\n`,
    output: `import * as Hex from "effect/encoding/Hex";\nHex.encode(a);\nHex.encode(b);\n`,
  },
  {
    name: "code already on 4.0.1 is left as it is",
    input: `import { HttpClient } from "effect/http";\nimport * as Base64 from "effect/encoding/Base64";\n`,
    output: `import { HttpClient } from "effect/http";\nimport * as Base64 from "effect/encoding/Base64";\n`,
  },
];

describe("effect-401 codemod", () => {
  it.each(cases)("$name", ({ path = "file.ts", input, output }) => {
    expect(rewriteFile(path, input).text).toBe(output);
  });

  it.each(cases)("a second run over $name changes nothing", ({ path = "file.ts", input }) => {
    const once = rewriteFile(path, input).text;
    const twice = rewriteFile(path, once);
    expect(twice.text).toBe(once);
    expect(twice.changes).toEqual([]);
  });

  it.each([
    {
      name: "an area 4.0.1 does not export",
      input: `import * as A from "effect/unstable/arbitrary/Arbitrary";\n`,
      line: 1,
    },
    {
      name: "an Encoding member with no new home",
      input: `import * as Encoding from "effect/Encoding";\n\nEncoding.somethingNew(x);\n`,
      line: 3,
    },
    {
      name: "Encoding passed around as a value",
      input: `import * as Encoding from "effect/Encoding";\nuse(Encoding);\n`,
      line: 2,
    },
    {
      name: "a new module name already taken in the file",
      input: `import * as Encoding from "effect/Encoding";\nconst Hex = 1;\nEncoding.encodeHex(b);\n`,
      line: 1,
    },
    {
      name: "a named import from Encoding",
      input: `import { encodeHex } from "effect/Encoding";\n`,
      line: 1,
    },
    {
      name: "SchemaGetter.onSome, removed in 4.0.1",
      input: `const g = SchemaGetter.onSome((input: string) => x);\n`,
      line: 1,
    },
    {
      name: "the removed .compose method",
      input: `const t = SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase());\n`,
      line: 1,
    },
  ])("$name is left untouched and listed as a hand fix", ({ input, line }) => {
    const result = rewriteFile("file.ts", input);
    expect(result.text).toBe(input);
    expect(result.handFixes.map((site) => site.line)).toContain(line);
  });

  it.each([
    {
      name: "Effect.partition, whose tuple order flipped",
      input: `const [a, b] = yield* Effect.partition(xs, f);\n`,
    },
    {
      name: "Stream.scan with an eager initial state",
      input: `stream.pipe(Stream.scan([], f));\n`,
    },
    {
      name: "TracerDisabledWhen beside an HttpRouter",
      input: `import { HttpRouter } from "effect/http";\nLayer.succeed(HttpMiddleware.TracerDisabledWhen)(f);\n`,
    },
  ])("$name is listed as a check", ({ input }) => {
    expect(rewriteFile("file.ts", input).checks).not.toEqual([]);
  });

  it.each([`Stream.scan(() => [], f);\n`, `Stream.scan(seedState, f);\n`])(
    "a Stream.scan already given a lazy initial state is not listed: %s",
    (input) => {
      expect(rewriteFile("file.ts", input).checks).toEqual([]);
    },
  );

  it.each([
    {
      path: "packages/effect-acp/src/client.ts",
      upstream: [
        `import * as Encoding from "effect/Encoding";`,
        `import { HttpApi } from "effect/unstable/httpapi";`,
        `import * as NodeServices from "@effect/platform-node/NodeServices";`,
        `import * as RpcClient from "effect/unstable/rpc/RpcClient";`,
        ``,
      ].join("\n"),
      expected: [`from "effect/Encoding"`, `from "effect/http-api"`, `from "effect/rpc/RpcClient"`],
    },
    {
      path: "packages/effect-acp/src/protocol.ts",
      upstream: [
        `import * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";`,
        `const parserFactory = RpcSerialization.ndJsonRpc();`,
        `const run = () => {`,
        `  const parser = parserFactory.makeUnsafe();`,
        `};`,
        ``,
      ].join("\n"),
      expected: [
        `const makeStrictNdJsonRpcParser = () => {`,
        `const parser = makeStrictNdJsonRpcParser();`,
      ],
    },
  ])(
    "the Import zone's transform over $path is undone byte for byte by its inverse",
    ({ path, upstream, expected }) => {
      const transformed = transformImportZoneFile(path, upstream);
      for (const text of expected) expect(transformed).toContain(text);
      expect(transformImportZoneFile(path, transformed)).toBe(transformed);
      expect(restoreImportZoneFile(path, transformed)).toBe(upstream);
    },
  );
});
