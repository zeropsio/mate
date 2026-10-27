// @effect-diagnostics nodeBuiltinImport:off -- a set's files stream to and from the bucket over HTTPS, signed with the system's HMAC.
/**
 * HQ's backup sets in its Object Storage bucket (`backup`, vysledky/hq-backup.md §3): S3, path-style
 * (`<url>/<bucket>/<key>`, as Zerops' MinIO serves it), every request signed with AWS Signature
 * Version 4. A file uploads in one request, its SHA-256 signed, so the bucket refuses a body that
 * arrives otherwise; it downloads streamed to its file. An error names the request and S3's code,
 * never a credential.
 *
 * @module bucketStore
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodePath from "node:path";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { BackupError, type BackupStore, type StoredObject, digestOf, io } from "./backup.ts";

/** Who may reach the bucket: its key and secret, and the region requests are signed for. */
export interface BucketCredentials {
  readonly keyId: string;
  readonly secret: Redacted.Redacted;
  readonly region: string;
}

const sha256 = (data: string) => NodeCrypto.createHash("sha256").update(data).digest("hex");
const hmac = (key: NodeCrypto.BinaryLike, data: string) =>
  NodeCrypto.createHmac("sha256", key).update(data).digest();

/** S3's URI encoding: every byte but the unreserved percent-encoded, `/` too unless a path's. */
const uriEncode = (text: string, path = false) =>
  [...new TextEncoder().encode(text)]
    .map((byte) => {
      const char = String.fromCodePoint(byte);
      return /[A-Za-z0-9\-._~]/u.test(char) || (path && char === "/")
        ? char
        : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    })
    .join("");

/** The canonical query string: each name and value encoded, sorted by name. */
export const canonicalQuery = (query: Readonly<Record<string, string>>) =>
  Object.entries(query)
    .map(([name, value]) => `${uriEncode(name)}=${uriEncode(value)}`)
    .sort()
    .join("&");

/**
 * The `Authorization` of a request to S3, signed over its host, its payload's SHA-256 and its time
 * (`x-amz-date`, `YYYYMMDDTHHMMSSZ`): the three headers it is sent with.
 */
export const signV4 = (
  request: {
    readonly method: string;
    readonly host: string;
    readonly path: string;
    readonly query: Readonly<Record<string, string>>;
    readonly payloadHash: string;
    readonly amzDate: string;
  },
  credentials: BucketCredentials,
) => {
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    request.method,
    uriEncode(request.path, true),
    canonicalQuery(request.query),
    `host:${request.host}`,
    `x-amz-content-sha256:${request.payloadHash}`,
    `x-amz-date:${request.amzDate}`,
    "",
    signed,
    request.payloadHash,
  ].join("\n");
  const scope = `${request.amzDate.slice(0, 8)}/${credentials.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", request.amzDate, scope, sha256(canonical)].join("\n");
  const key = [
    request.amzDate.slice(0, 8),
    credentials.region,
    "s3",
    "aws4_request",
  ].reduce<NodeCrypto.BinaryLike>(
    (previous, part) => hmac(previous, part),
    `AWS4${Redacted.value(credentials.secret)}`,
  );
  const signature = NodeCrypto.createHmac("sha256", key).update(toSign).digest("hex");
  return `AWS4-HMAC-SHA256 Credential=${credentials.keyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`;
};

/** Where the bucket is, and who may reach it. */
export interface BucketAccess extends BucketCredentials {
  /** The Object Storage's API URL (`apiUrl`). */
  readonly url: string;
  readonly bucket: string;
}

/** The SHA-256 of nothing: a request without a body. */
const EMPTY = sha256("");

const unescapeXml = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

/** The bucket as a store of sets. */
export const bucketStore = (access: BucketAccess): BackupStore => {
  const base = new URL(access.url);
  const transport = base.protocol === "https:" ? NodeHttps : NodeHttp;

  /** One request to the bucket: its body from `upload`, its answer into `download` or as text. */
  const send = (
    method: string,
    key: string,
    query: Readonly<Record<string, string>>,
    upload: { readonly file: string; readonly size: number; readonly sha256: string } | null,
    download: string | null,
  ) =>
    Effect.flatMap(DateTime.now, (now) => {
      const what = `${method} ${key === "" ? access.bucket : key}`;
      const path = key === "" ? `/${access.bucket}` : `/${access.bucket}/${key}`;
      const amzDate = DateTime.formatIso(now)
        .replace(/[-:]/gu, "")
        .replace(/\.\d+Z$/u, "Z");
      const payloadHash = upload?.sha256 ?? EMPTY;
      const search = canonicalQuery(query);
      return io(
        what,
        () =>
          new Promise<{ readonly status: number; readonly text: string }>((resolve, reject) => {
            const request = transport.request(
              {
                protocol: base.protocol,
                hostname: base.hostname,
                port: base.port,
                method,
                path: `${uriEncode(path, true)}${search === "" ? "" : `?${search}`}`,
                headers: {
                  host: base.host,
                  "x-amz-date": amzDate,
                  "x-amz-content-sha256": payloadHash,
                  authorization: signV4(
                    { method, host: base.host, path, query, payloadHash, amzDate },
                    access,
                  ),
                  ...(upload === null ? {} : { "content-length": String(upload.size) }),
                },
              },
              (response) => {
                const status = response.statusCode ?? 0;
                response.on("error", reject);
                if (download !== null && status === 200) {
                  const file = NodeFS.createWriteStream(download);
                  file.on("error", reject).on("finish", () => resolve({ status, text: "" }));
                  response.pipe(file);
                  return;
                }
                const chunks: Array<Uint8Array> = [];
                response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
                response.on("end", () =>
                  resolve({ status, text: Buffer.concat(chunks).toString("utf8") }),
                );
              },
            );
            request.on("error", reject);
            if (upload === null) request.end();
            else NodeFS.createReadStream(upload.file).on("error", reject).pipe(request);
          }),
      ).pipe(
        Effect.flatMap(({ status, text }) =>
          status >= 200 && status < 300
            ? Effect.succeed(text)
            : Effect.fail(
                new BackupError({
                  reason: "store",
                  message: `${what}: ${String(status)} ${/<Code>(.*?)<\/Code>/u.exec(text)?.[1] ?? ""}`,
                }),
              ),
        ),
      );
    });

  return {
    put: (key, file) =>
      Effect.gen(function* () {
        const size = (yield* io(`put ${key}`, () => NodeFSP.stat(file))).size;
        yield* send("PUT", key, {}, { file, size, sha256: yield* digestOf(file) }, null);
      }),
    get: (key, file) =>
      Effect.andThen(
        io(`get ${key}`, () => NodeFSP.mkdir(NodePath.dirname(file), { recursive: true })),
        send("GET", key, {}, null, file),
      ),
    list: (prefix) =>
      Effect.gen(function* () {
        const found: Array<StoredObject> = [];
        let token: string | undefined;
        do {
          const page = yield* send(
            "GET",
            "",
            {
              "list-type": "2",
              prefix,
              ...(token === undefined ? {} : { "continuation-token": token }),
            },
            null,
            null,
          );
          for (const [, contents = ""] of page.matchAll(/<Contents>([\s\S]*?)<\/Contents>/gu)) {
            found.push({
              key: unescapeXml(/<Key>([\s\S]*?)<\/Key>/u.exec(contents)?.[1] ?? ""),
              size: Number(/<Size>(\d+)<\/Size>/u.exec(contents)?.[1] ?? 0),
            });
          }
          token = /<IsTruncated>true<\/IsTruncated>/u.test(page)
            ? unescapeXml(
                /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/u.exec(page)?.[1] ?? "",
              )
            : undefined;
        } while (token !== undefined && token !== "");
        return found;
      }),
    remove: (key) => Effect.asVoid(send("DELETE", key, {}, null, null)),
  };
};

/** HQ's variables for its bucket: the `backup` service's own, by reference (the birth import). */
export const BUCKET_ENV = [
  "HQ_BACKUP_URL",
  "HQ_BACKUP_KEY_ID",
  "HQ_BACKUP_SECRET",
  "HQ_BACKUP_BUCKET",
  "HQ_BACKUP_QUOTA_GB",
] as const;

/**
 * The bucket from HQ's environment (`BUCKET_ENV`) and its quota; none, backup off, when any is
 * absent, empty, or still a `${…}` reference (a project without the service), or the quota is no
 * positive number. Requests are signed for `us-east-1`, MinIO's region when none is set.
 */
export const bucketFromEnv = (
  env: Readonly<Record<string, string | undefined>>,
): { readonly access: BucketAccess; readonly quotaGb: number } | null => {
  const values = BUCKET_ENV.map((name) => env[name]?.trim() ?? "");
  if (values.some((value) => value === "" || value.includes("${"))) return null;
  const [url = "", keyId = "", secret = "", bucket = "", quota = ""] = values;
  const quotaGb = Number(quota);
  if (!Number.isFinite(quotaGb) || quotaGb <= 0) return null;
  return {
    access: { url, bucket, keyId, secret: Redacted.make(secret), region: "us-east-1" },
    quotaGb,
  };
};
