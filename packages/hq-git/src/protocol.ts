import type { GitService, GitTarget, RefDecision, RefUpdate } from "./api.ts";

const TARGET =
  /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;

/**
 * What a request asks, read off its raw path as the handler serves it — a URL parser would resolve
 * `..` and `%2e%2e` into another repository — and its query, everything after the first `?`.
 */
export const gitTarget = (prefix: string, url: string): GitTarget | null => {
  const mark = url.includes("?") ? url.indexOf("?") : url.length;
  const [path, query] = [url.slice(0, mark), url.slice(mark + 1)];
  if (!path.startsWith(`${prefix}/`)) return null;
  const match = TARGET.exec(path.slice(prefix.length + 1));
  if (!match) return null;
  const operation = match[3] as GitTarget["operation"];
  const asked = operation === "info/refs" ? new URLSearchParams(query).get("service") : operation;
  const service: GitService | null =
    asked === "git-upload-pack" || asked === "git-receive-pack" ? asked : null;
  return { repo: { appId: match[1]!, id: match[2]! }, operation, service };
};

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const pkt = (payload: string | Buffer): Buffer => {
  const bytes = Buffer.from(payload);
  return Buffer.concat([Buffer.from((bytes.length + 4).toString(16).padStart(4, "0")), bytes]);
};

/** Consume only the bounded command section; replay includes the pack's first chunk unchanged. */
export const readPush = async (input: AsyncIterator<Buffer>) => {
  const chunks: Buffer[] = [];
  const updates: RefUpdate[] = [];
  const refs = new Set<string>();
  let capabilities: string[] = [];
  let pending = Buffer.alloc(0);
  let commandBytes = 0;
  for (;;) {
    if (pending.length < 4) {
      const next = await input.next();
      if (next.done) throw new HttpError(400, "Incomplete push commands");
      chunks.push(next.value);
      pending = Buffer.concat([pending, next.value]);
      continue;
    }
    const head = pending.subarray(0, 4).toString("ascii");
    if (!/^[0-9a-fA-F]{4}$/.test(head)) throw new HttpError(400, "Invalid pkt-line length");
    const length = Number.parseInt(head, 16);
    if (length === 0) {
      return { updates, capabilities, replay: Buffer.concat(chunks) };
    }
    if (length < 4 || length > 65_520) throw new HttpError(400, "Invalid pkt-line length");
    if (commandBytes + length > 1024 * 1024)
      throw new HttpError(413, "Push command section exceeds limit");
    if (pending.length < length) {
      const next = await input.next();
      if (next.done) throw new HttpError(400, "Incomplete push commands");
      chunks.push(next.value);
      pending = Buffer.concat([pending, next.value]);
      continue;
    }
    const payload = pending.subarray(4, length);
    const text = payload.toString("utf8");
    if (!Buffer.from(text).equals(payload)) throw new HttpError(400, "Invalid command encoding");
    pending = pending.subarray(length);
    commandBytes += length;
    const line = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (updates.length === 0 && /^shallow (?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(line)) continue;
    const nul = line.indexOf("\0");
    if (nul !== -1) {
      if (updates.length > 0 || line.indexOf("\0", nul + 1) !== -1)
        throw new HttpError(400, "Invalid capability section");
      capabilities = line
        .slice(nul + 1)
        .split(" ")
        .filter(Boolean);
      if (capabilities.some((cap) => !/^[\x21-\x7e]+$/.test(cap) || cap === "push-options")) {
        throw new HttpError(400, "Unsupported push capabilities");
      }
    }
    const command = nul < 0 ? line : line.slice(0, nul);
    const match = /^([0-9a-f]{40}|[0-9a-f]{64}) ([0-9a-f]{40}|[0-9a-f]{64}) ([^\0\r\n]+)$/.exec(
      command,
    );
    if (!match || match[1]?.length !== match[2]?.length)
      throw new HttpError(400, "Invalid push command");
    const oldSha = match[1]!;
    const newSha = match[2]!;
    const ref = match[3]!;
    if (refs.has(ref)) throw new HttpError(400, "Duplicate ref in push");
    refs.add(ref);
    updates.push({ oldSha, newSha, ref });
  }
};

const sanitize = (text: string, limit: number, replacement: string) =>
  Array.from(text, (char) =>
    char.charCodeAt(0) < limit || char.charCodeAt(0) === 127 ? replacement : char,
  ).join("");

export const refusalReport = (
  updates: ReadonlyArray<RefUpdate>,
  decisions: ReadonlyArray<RefDecision>,
  capabilities: ReadonlyArray<string>,
): Buffer => {
  const reasons = updates.map((update, index) => {
    const decision = decisions[index]!;
    // Refused only because another ref was: authorization is all-or-nothing, git's apply is not.
    const reason = decision.allowed ? "other_ref_refused" : decision.reason;
    // A port's free-form reason must not inject packet framing or additional report lines.
    return `ng ${sanitize(update.ref, 33, "?")} ${sanitize(reason, 32, " ").slice(0, 512)}\n`;
  });
  const report = capabilities.some((cap) => cap === "report-status" || cap === "report-status-v2")
    ? Buffer.concat([pkt("unpack ok\n"), ...reasons.map(pkt), Buffer.from("0000")])
    : pkt(`ERR ${reasons.join("").trim()}\n`);
  const max = capabilities.includes("side-band-64k")
    ? 65_515
    : capabilities.includes("side-band")
      ? 995
      : 0;
  if (!max) return report;
  const packets: Buffer[] = [];
  for (let offset = 0; offset < report.length; offset += max) {
    packets.push(pkt(Buffer.concat([Buffer.from([1]), report.subarray(offset, offset + max)])));
  }
  return Buffer.concat([...packets, Buffer.from("0000")]);
};
