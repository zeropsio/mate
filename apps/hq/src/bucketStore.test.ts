// @effect-diagnostics nodeBuiltinImport:off -- the tests serve a bucket of their own over HTTP.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { tempDir } from "../test/harness/tempDir.ts";
import { type BucketCredentials, bucketFromEnv, bucketStore, signV4 } from "./bucketStore.ts";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const EXAMPLE = {
  keyId: "AKIAIOSFODNN7EXAMPLE",
  secret: Redacted.make("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
  region: "us-east-1",
};

describe("a request signed with AWS Signature Version 4", () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly request: Parameters<typeof signV4>[0];
    readonly signature: string;
  }> = [
    {
      // AWS's own example: "GET Bucket (List Objects)", Signature Version 4 for S3.
      name: "as AWS signs its listing example",
      request: {
        method: "GET",
        host: "examplebucket.s3.amazonaws.com",
        path: "/",
        query: { "max-keys": "2", prefix: "J" },
        payloadHash: EMPTY,
        amzDate: "20130524T000000Z",
      },
      signature: "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7",
    },
    // The two below as the `aws4` package signs them.
    {
      name: "a file put path-style, its digest signed",
      request: {
        method: "PUT",
        host: "storage-prg1.zerops.io",
        path: "/hq-backup/sets/20261002T120000.000Z/db.dump",
        query: {},
        payloadHash: "44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072",
        amzDate: "20261002T120000Z",
      },
      signature: "37eb0ce1c01ccbd063b4410e5e8faa321e97c8303309090315eb4f76c2e69128",
    },
    {
      name: "a listing's next page, its token encoded",
      request: {
        method: "GET",
        host: "storage-prg1.zerops.io",
        path: "/hq-backup",
        query: { "list-type": "2", prefix: "sets/", "continuation-token": "a+b=" },
        payloadHash: EMPTY,
        amzDate: "20261002T120000Z",
      },
      signature: "ce9f7bd657c35a0d7a99355fe0ec1f0f5b757f5d4f3c253fa34dd17d2feac58b",
    },
  ];
  it.each(
    Array.from(cases, ({ name, request, signature }) => ({ title: name, request, signature })),
  )("$title", ({ request, signature }) => {
    const date = request.amzDate.slice(0, 8);
    assert.strictEqual(
      signV4(request, EXAMPLE),
      `AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/${date}/us-east-1/s3/aws4_request, ` +
        `SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`,
    );
  });
});

/**
 * A bucket as MinIO serves it path-style, in memory, two keys a page; a request whose signature is
 * not `credentials`' own is refused as S3 refuses it.
 */
const fakeBucket = (bucket: string, credentials: BucketCredentials) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{ readonly url: string; readonly server: NodeHttp.Server }>((resolve) => {
          const objects = new Map<string, Uint8Array>();
          const server = NodeHttp.createServer((request, response) => {
            const chunks: Array<Uint8Array> = [];
            request.on("data", (chunk: Uint8Array) => chunks.push(chunk));
            request.on("end", () => {
              const url = new URL(request.url ?? "/", "http://bucket");
              const header = (name: string) => String(request.headers[name] ?? "");
              const fail = (status: number, code: string) =>
                response.writeHead(status).end(`<Error><Code>${code}</Code></Error>`);
              const body = Buffer.concat(chunks);
              const expected = signV4(
                {
                  method: request.method ?? "",
                  host: header("host"),
                  path: decodeURIComponent(url.pathname),
                  query: Object.fromEntries(url.searchParams),
                  payloadHash: header("x-amz-content-sha256"),
                  amzDate: header("x-amz-date"),
                },
                credentials,
              );
              if (header("authorization") !== expected) return fail(403, "SignatureDoesNotMatch");
              const [, name, ...rest] = decodeURIComponent(url.pathname).split("/");
              if (name !== bucket) return fail(404, "NoSuchBucket");
              const key = rest.join("/");
              if (request.method === "PUT") {
                const digest = NodeCrypto.createHash("sha256").update(body).digest("hex");
                if (digest !== header("x-amz-content-sha256")) {
                  return fail(400, "XAmzContentSHA256Mismatch");
                }
                objects.set(key, body);
                return response.writeHead(200).end();
              }
              if (request.method === "DELETE") {
                objects.delete(key);
                return response.writeHead(204).end();
              }
              if (key !== "") {
                const object = objects.get(key);
                return object === undefined
                  ? fail(404, "NoSuchKey")
                  : response.writeHead(200).end(object);
              }
              const prefix = url.searchParams.get("prefix") ?? "";
              const after = url.searchParams.get("continuation-token") ?? "";
              const keys = [...objects.keys()]
                .filter((each) => each.startsWith(prefix) && each > after)
                .sort();
              const page = keys.slice(0, 2);
              const truncated = keys.length > page.length;
              return response
                .writeHead(200)
                .end(
                  `<ListBucketResult>${page
                    .map(
                      (each) =>
                        `<Contents><Key>${each}</Key><Size>${String(objects.get(each)?.length)}</Size></Contents>`,
                    )
                    .join("")}<IsTruncated>${String(truncated)}</IsTruncated>${
                    truncated
                      ? `<NextContinuationToken>${page.at(-1) ?? ""}</NextContinuationToken>`
                      : ""
                  }</ListBucketResult>`,
                );
            });
          });
          server.listen(0, "127.0.0.1", () => {
            const address = server.address();
            const port = typeof address === "object" && address !== null ? address.port : 0;
            resolve({ url: `http://127.0.0.1:${String(port)}`, server });
          });
        }),
    ),
    ({ server }) => Effect.promise(() => new Promise<void>((done) => server.close(() => done()))),
  );

describe("a bucket store", () => {
  it.effect("keeps files, lists them page by page, gives them back and removes them", () =>
    Effect.gen(function* () {
      const { url } = yield* fakeBucket("hq-backup", EXAMPLE);
      const store = bucketStore({ url, bucket: "hq-backup", ...EXAMPLE });
      const dir = yield* tempDir("hq-bucket-");
      const files = { dump: "x".repeat(1000), manifest: "{}", other: "y".repeat(10) };
      for (const [name, text] of Object.entries(files)) {
        NodeFS.writeFileSync(NodePath.join(dir, name), text);
      }
      yield* store.put("sets/1/db.dump", NodePath.join(dir, "dump"));
      yield* store.put("sets/1/manifest.json", NodePath.join(dir, "manifest"));
      yield* store.put("sets/2/db.dump", NodePath.join(dir, "other"));

      assert.deepStrictEqual(yield* store.list("sets/"), [
        { key: "sets/1/db.dump", size: 1000 },
        { key: "sets/1/manifest.json", size: 2 },
        { key: "sets/2/db.dump", size: 10 },
      ]);
      yield* store.get("sets/1/db.dump", NodePath.join(dir, "back", "dump"));
      assert.strictEqual(
        NodeFS.readFileSync(NodePath.join(dir, "back", "dump"), "utf8"),
        files.dump,
      );
      yield* store.remove("sets/1/db.dump");
      assert.deepStrictEqual(
        (yield* store.list("sets/")).map((object) => object.key),
        ["sets/1/manifest.json", "sets/2/db.dump"],
      );
      const missing = yield* Effect.flip(store.get("sets/9/db.dump", NodePath.join(dir, "x")));
      assert.deepStrictEqual(
        [missing.reason, missing.message.includes("NoSuchKey")],
        ["store", true],
      );
    }),
  );

  it.effect("is refused with a wrong secret, and names no secret", () =>
    Effect.gen(function* () {
      const { url } = yield* fakeBucket("hq-backup", EXAMPLE);
      const wrong = Redacted.make("not-the-secret");
      const store = bucketStore({ url, bucket: "hq-backup", ...EXAMPLE, secret: wrong });
      const refused = yield* Effect.flip(store.list("sets/"));
      assert.deepStrictEqual(
        [refused.reason, refused.message.includes("SignatureDoesNotMatch")],
        ["store", true],
      );
      assert.notInclude(refused.message, "not-the-secret");
    }),
  );
});

describe("the bucket, from HQ's environment", () => {
  const all = {
    HQ_BACKUP_URL: "https://storage-prg1.zerops.io",
    HQ_BACKUP_KEY_ID: "KEY",
    HQ_BACKUP_SECRET: "SECRET",
    HQ_BACKUP_BUCKET: "abc-backup",
    HQ_BACKUP_QUOTA_GB: "80",
  };
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly env: Readonly<Record<string, string | undefined>>;
    readonly bucket: boolean;
  }> = [
    { name: "is there with all five", env: all, bucket: true },
    { name: "is off without one", env: { ...all, HQ_BACKUP_SECRET: undefined }, bucket: false },
    { name: "is off with one empty", env: { ...all, HQ_BACKUP_BUCKET: " " }, bucket: false },
    // A reference to a service the project lacks stays as written.
    {
      name: "is off with one still a reference",
      env: { ...all, HQ_BACKUP_URL: "${backup_apiUrl}" },
      bucket: false,
    },
    {
      name: "is off with a quota not a number",
      env: { ...all, HQ_BACKUP_QUOTA_GB: "lots" },
      bucket: false,
    },
  ];
  it.each(Array.from(cases, ({ name, env, bucket }) => ({ title: name, env, bucket })))(
    "$title",
    ({ env, bucket }) => {
      const found = bucketFromEnv(env);
      assert.deepStrictEqual(
        found === null
          ? null
          : { ...found, access: { ...found.access, secret: Redacted.value(found.access.secret) } },
        bucket
          ? {
              access: {
                url: "https://storage-prg1.zerops.io",
                bucket: "abc-backup",
                keyId: "KEY",
                secret: "SECRET",
                region: "us-east-1",
              },
              quotaGb: 80,
            }
          : null,
      );
    },
  );
});
