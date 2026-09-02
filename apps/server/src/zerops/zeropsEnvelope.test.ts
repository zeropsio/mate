import { describe, expect, it } from "@effect/vitest";

import {
  ZEROPS_ENVELOPE_FENCE,
  decodeZeropsEnvelope,
  extractZeropsEnvelope,
  extractZeropsEnvelopeBlock,
} from "./zeropsEnvelope.ts";

/**
 * The wire shape zcp's `workflow.AppendEnvelope` produces: markdown, a blank
 * line, then a three-line fenced block whose body is compact single-line JSON.
 * Contract: zcp `docs/spec-mate.md` §1.1, reference `internal/workflow/envelope_wire.go`.
 */
const block = (body: string): string => `\`\`\`${ZEROPS_ENVELOPE_FENCE}\n${body}\n\`\`\`\n`;

const envelopeJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    phase: "develop-active",
    environment: "container",
    selfService: { hostname: "zcp" },
    project: { id: "proj-1", name: "z3-eval" },
    services: [
      {
        hostname: "apidev",
        typeVersion: "nodejs@22",
        runtimeClass: "dynamic",
        status: "ACTIVE",
        bootstrapped: true,
        deployed: true,
        mode: "standard",
        closeDeployMode: "auto",
        gitPushState: "configured",
        remoteUrl: "https://github.com/acme/api",
        stageHostname: "apistage",
        setupName: "api",
        stageSetupName: "apistage",
      },
      {
        hostname: "db",
        typeVersion: "postgresql@16",
        runtimeClass: "managed",
        status: "ACTIVE",
        bootstrapped: true,
      },
    ],
    workSession: {
      intent: "add health endpoint",
      services: ["apidev"],
      roles: { apidev: "required" },
      createdAt: "2026-08-28T12:00:00Z",
      deploys: {
        apidev: [{ at: "2026-08-28T12:00:00Z", success: true, iteration: 1, setup: "api" }],
      },
      verifies: {
        apidev: [{ at: "2026-08-28T12:00:00Z", success: true, iteration: 1, summary: "healthy" }],
      },
    },
    bootstrap: { route: "classic", step: "provision", intent: "node api with postgres" },
    generated: "2026-08-28T12:00:00Z",
    ...overrides,
  });

const resultText = (overrides?: Record<string, unknown>): string =>
  `## Status\n\nPhase: develop-active\n\n${block(envelopeJson(overrides))}`;

describe("extractZeropsEnvelopeBlock", () => {
  it("finds the body of a well-formed trailing block", () => {
    const body = envelopeJson();
    expect(extractZeropsEnvelopeBlock(resultText())).toBe(body);
  });

  it("returns the LAST complete block — a transcript may concatenate results", () => {
    const text = `${block(envelopeJson({ phase: "idle" }))}\nsecond result\n\n${block(
      envelopeJson({ phase: "develop-active" }),
    )}`;
    expect(extractZeropsEnvelopeBlock(text)).toContain('"phase":"develop-active"');
  });

  it("skips an unterminated trailing block and keeps scanning backwards", () => {
    const truncated = `\`\`\`${ZEROPS_ENVELOPE_FENCE}\n{"phase":"truncated"`;
    const text = `${block(envelopeJson({ phase: "idle" }))}\nmore\n\n${truncated}`;
    expect(extractZeropsEnvelopeBlock(text)).toContain('"phase":"idle"');
  });

  it("tolerates trailing whitespace and CRLF around the fences", () => {
    const text = [
      "intro",
      "",
      `\`\`\`${ZEROPS_ENVELOPE_FENCE}  `,
      envelopeJson(),
      "```  ",
      "",
    ].join("\r\n");
    expect(extractZeropsEnvelopeBlock(text)).toBe(envelopeJson());
  });

  it.each([
    ["empty", ""],
    ["plain markdown", "## Status\n\nPhase: idle\n"],
    ["a different fenced block", '```json\n{"phase":"idle"}\n```\n'],
    [
      "an unterminated block on its own",
      `text\n\n\`\`\`${ZEROPS_ENVELOPE_FENCE}\n{"phase":"idle"}\n`,
    ],
    ["the fence mentioned mid-line", `the block is \`\`\`${ZEROPS_ENVELOPE_FENCE} shaped\n`],
    [
      "the fence with trailing prose on its line",
      `\`\`\`${ZEROPS_ENVELOPE_FENCE} extra\n{}\n\`\`\`\n`,
    ],
  ])("returns undefined for %s", (_label, text) => {
    expect(extractZeropsEnvelopeBlock(text)).toBeUndefined();
  });
});

describe("decodeZeropsEnvelope", () => {
  it("decodes a full envelope", () => {
    const envelope = decodeZeropsEnvelope(envelopeJson());
    expect(envelope?.phase).toBe("develop-active");
    expect(envelope?.project.name).toBe("z3-eval");
    expect(envelope?.services.map((service) => service.hostname)).toEqual(["apidev", "db"]);
    expect(envelope?.workSession?.intent).toBe("add health endpoint");
    expect(envelope?.workSession?.deploys?.apidev?.[0]?.success).toBe(true);
    expect(envelope?.bootstrap?.route).toBe("classic");
  });

  it("accepts a phase this build has never heard of", () => {
    // zcp added `launch-production-active` after the client shipped; a literal
    // union here would blank the whole strip instead of one field.
    const envelope = decodeZeropsEnvelope(envelopeJson({ phase: "some-future-phase" }));
    expect(envelope?.phase).toBe("some-future-phase");
  });

  it("ignores unknown fields, at the top level and inside a service", () => {
    const raw = JSON.parse(envelopeJson()) as Record<string, unknown>;
    raw.futureField = { anything: true };
    (raw.services as Array<Record<string, unknown>>)[0]!.futureServiceField = 42;
    const envelope = decodeZeropsEnvelope(JSON.stringify(raw));
    expect(envelope?.services).toHaveLength(2);
    expect(envelope?.services[0]?.hostname).toBe("apidev");
  });

  it("drops a service it cannot decode rather than failing the envelope", () => {
    const raw = JSON.parse(envelopeJson()) as Record<string, unknown>;
    (raw.services as Array<unknown>).push({ hostname: 17 });
    const envelope = decodeZeropsEnvelope(JSON.stringify(raw));
    expect(envelope?.services.map((service) => service.hostname)).toEqual(["apidev", "db"]);
  });

  it.each([
    ["not JSON", "not json"],
    ["JSON that is not an object", "[1,2,3]"],
    ["an object missing required fields", '{"phase":"idle"}'],
  ])("returns undefined for %s", (_label, body) => {
    expect(decodeZeropsEnvelope(body)).toBeUndefined();
  });
});

describe("extractZeropsEnvelope — the fenced-block carrier", () => {
  it("reads the envelope out of a rendered tool result", () => {
    expect(extractZeropsEnvelope(resultText())?.phase).toBe("develop-active");
  });

  it("does NOT fall back to an earlier block when the last one is malformed", () => {
    // Mirrors `workflow.ExtractEnvelope`: an unparseable last *complete* block
    // means the reducer keeps its previous state. Silently adopting an older
    // envelope would move the strip backwards.
    const text = `${block(envelopeJson({ phase: "idle" }))}\n\n${block("not json")}`;
    expect(extractZeropsEnvelope(text)).toBeUndefined();
  });

  it.each([
    ["no block at all", "## Status\n\nPhase: idle\n"],
    ["a malformed block", `text\n\n${"```"}${ZEROPS_ENVELOPE_FENCE}\nnot json\n${"```"}\n`],
    ["an unterminated block", `text\n\n${"```"}${ZEROPS_ENVELOPE_FENCE}\n{"phase":"idle"}\n`],
  ])("returns undefined for %s", (_label, text) => {
    expect(extractZeropsEnvelope(text)).toBeUndefined();
  });
});

describe("extractZeropsEnvelope — the JSON-document carrier", () => {
  const jsonResult = (extra: Record<string, unknown>) =>
    JSON.stringify({ service: "kanbandev", status: "ok", ...extra });

  it("reads a top-level envelope key out of a JSON result", () => {
    // zerops_deploy / verify / import / mount return one JSON document, which a
    // markdown fence cannot be appended to without breaking the parse, so those
    // carry the envelope as a field instead.
    const text = jsonResult({ envelope: JSON.parse(envelopeJson()) as unknown });
    expect(extractZeropsEnvelope(text)?.phase).toBe("develop-active");
    expect(extractZeropsEnvelope(text)?.services).toHaveLength(2);
  });

  it("returns undefined for a JSON result with no envelope key", () => {
    expect(extractZeropsEnvelope(jsonResult({}))).toBeUndefined();
  });

  it("returns undefined when the envelope key holds something that is not one", () => {
    expect(extractZeropsEnvelope(jsonResult({ envelope: "not an envelope" }))).toBeUndefined();
    expect(extractZeropsEnvelope(jsonResult({ envelope: null }))).toBeUndefined();
  });

  it("does not read a fenced block quoted inside a JSON document", () => {
    // A JSON result can carry agent prose in a field — logs, a rendered error —
    // and that prose can quote this very format. A document that parses as JSON
    // is the carrier, and its `envelope` key is the only answer; falling through
    // to the fence rule would let quoted text become state.
    const text = jsonResult({ logs: `\n${block(envelopeJson())}` });
    expect(extractZeropsEnvelope(text)).toBeUndefined();
  });

  it("still prefers the envelope key when the document also quotes a block", () => {
    const text = jsonResult({
      envelope: JSON.parse(envelopeJson({ phase: "idle" })) as unknown,
      logs: block(envelopeJson({ phase: "develop-active" })),
    });
    expect(extractZeropsEnvelope(text)?.phase).toBe("idle");
  });

  it("falls back to the fence rule for text that is not a JSON document", () => {
    expect(extractZeropsEnvelope(resultText())?.phase).toBe("develop-active");
    expect(extractZeropsEnvelope(`[1,2,3]\n\n${block(envelopeJson())}`)?.phase).toBe(
      "develop-active",
    );
  });
});
