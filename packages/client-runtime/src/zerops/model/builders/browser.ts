import { browserFiguresLine, operationClosing, sentenceCase } from "../../operations/phrases.ts";
import type {
  ZeropsBrowserViewport,
  ZeropsCall,
  ZeropsOperationBrowserSummary,
  ZeropsOperationStep,
} from "../types.ts";
import {
  type BuiltCardFields,
  KIND_LABEL,
  buildStep,
  decodeCall,
  errorInfoFor,
  firstLine,
  gatedStatusWord,
  mateVoiceFor,
  phaseFor,
  pickFirst,
  readInputString,
} from "./shared.ts";

function browserStepNote(step: {
  readonly success: boolean;
  readonly errorKind?: string;
}): string | undefined {
  return step.success || step.errorKind === undefined ? undefined : sentenceCase(step.errorKind);
}

/**
 * The canonical reporting tail `buildCanonicalBatch` always appends
 * (`internal/ops/browser.go`): the screenshot step (only when requested),
 * `errors`, `console`, `network requests …`, `close`. Matched by the
 * step's own first command word — none of these names are ever the
 * agent's own action.
 */
const BROWSER_TAIL_COMMANDS: ReadonlySet<string> = new Set([
  "screenshot",
  "errors",
  "console",
  "network",
  "close",
]);

function isBrowserTailLabel(label: string): boolean {
  return BROWSER_TAIL_COMMANDS.has(label.split(" ")[0] ?? "");
}

/** `["set", "viewport", "1920", "1080"]` (agent-browser `set --help`) — the caller's own resize, if it issued one; a zero side is none. */
function browserViewportFromLabel(label: string): ZeropsBrowserViewport | undefined {
  const match = label.match(/^set viewport ([1-9]\d*) ([1-9]\d*)(?:\s|$)/);
  if (match === null) {
    return undefined;
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** `["set", "device", "iPhone", "14"]` — the device the caller emulated, as agent-browser names it. */
function browserDeviceFromLabel(label: string): string | undefined {
  const match = label.match(/^set device\s+"?([^"]+?)"?\s*$/);
  return match?.[1];
}

/**
 * A named device's viewport as its class draws it — a phone, a tablet — so a
 * frame has its shape before the picture arrives. The picture's own size
 * refines nothing here: it is in device pixels, the viewport in CSS pixels.
 */
function viewportForDevice(name: string): ZeropsBrowserViewport | undefined {
  if (/desktop/i.test(name)) return undefined;
  if (/ipad|tablet|\btab\b|kindle|nexus (7|9|10)/i.test(name)) return { width: 820, height: 1180 };
  return { width: 390, height: 844 };
}

function inputCommands(input: Record<string, unknown>): string[] {
  const commands = Array.isArray(input.commands) ? input.commands : [];
  return commands.flatMap((command) =>
    Array.isArray(command) && command.every((word) => typeof word === "string")
      ? [command.join(" ")]
      : [],
  );
}

/** The last resize among the call's own `commands` (`BrowserInput.Commands`, one string array each). */
function inputViewport(input: Record<string, unknown>): ZeropsBrowserViewport | undefined {
  let viewport: ZeropsBrowserViewport | undefined;
  for (const label of inputCommands(input)) {
    const device = browserDeviceFromLabel(label);
    viewport =
      browserViewportFromLabel(label) ??
      (device !== undefined ? viewportForDevice(device) : undefined) ??
      viewport;
  }
  return viewport;
}

/** The last device the call's own `commands` emulated. */
function inputDeviceName(input: Record<string, unknown>): string | undefined {
  let name: string | undefined;
  for (const label of inputCommands(input)) name = browserDeviceFromLabel(label) ?? name;
  return name;
}

const PNG_HEADER_BASE64_LENGTH = 32;

/** A PNG's pixel size from its header, for an image block that did not say. */
export function pngSize(base64: string): { width: number; height: number } | undefined {
  const head = base64.slice(0, PNG_HEADER_BASE64_LENGTH);
  if (!/^[A-Za-z0-9+/]{32}$/.test(head)) return undefined;
  const bytes = atob(head);
  if (
    bytes.charCodeAt(0) !== 0x89 ||
    bytes.slice(1, 4) !== "PNG" ||
    bytes.slice(12, 16) !== "IHDR"
  ) {
    return undefined;
  }
  const read = (offset: number) =>
    ((bytes.charCodeAt(offset) << 24) |
      (bytes.charCodeAt(offset + 1) << 16) |
      (bytes.charCodeAt(offset + 2) << 8) |
      bytes.charCodeAt(offset + 3)) >>>
    0;
  const width = read(16);
  const height = read(20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

/** `["set", "media", "dark"|"light", ...]` — the caller's own colour-scheme emulation, if it issued one. */
function browserMediaFromLabel(label: string): "dark" | "light" | undefined {
  const match = label.match(/^set media (dark|light)\b/);
  return match?.[1] === "dark" ? "dark" : match?.[1] === "light" ? "light" : undefined;
}

/**
 * `viewport`/`media` are the LAST matching step (a caller may resize more
 * than once); `stepCount`/`failedStep` look only at the non-tail steps —
 * the reporting tail is plumbing, never something a person reads as "what
 * the agent did".
 */
function browserSummaryFor(
  steps: ReadonlyArray<ZeropsOperationStep>,
  counts: { consoleErrorCount: number; pageErrorCount: number; failedRequestCount: number },
): ZeropsOperationBrowserSummary {
  let viewport: ZeropsBrowserViewport | undefined;
  let media: "dark" | "light" | undefined;
  for (const step of steps) {
    if (step.kind === "tail") {
      continue;
    }
    viewport = browserViewportFromLabel(step.label) ?? viewport;
    media = browserMediaFromLabel(step.label) ?? media;
  }
  const visibleSteps = steps.filter((step) => step.kind !== "tail");
  const failedStep = visibleSteps.find((step) => step.state === "failed");
  return {
    ...(viewport !== undefined ? { viewport } : {}),
    ...(media !== undefined ? { media } : {}),
    stepCount: visibleSteps.length,
    ...(failedStep !== undefined ? { failedStep } : {}),
    errorCount: counts.consoleErrorCount + counts.pageErrorCount,
    failedRequestCount: counts.failedRequestCount,
    line: browserFiguresLine({
      stepCount: visibleSteps.length,
      ...counts,
      ...(viewport !== undefined ? { viewport } : {}),
      ...(media !== undefined ? { media } : {}),
    }),
  };
}

export function buildBrowserFields(call: ZeropsCall): BuiltCardFields {
  const decoded = decodeCall(call);
  const errorInfo = errorInfoFor(call, decoded);
  const card = decoded.card?.kind === "browser" ? decoded.card : undefined;
  const phase = phaseFor(call.status);
  const subject = pickFirst(readInputString(call.input, "url"), card?.url) ?? "the page";
  const { voice, voiceSource } = mateVoiceFor("browser", subject);

  const steps = (card?.steps ?? []).map((step, index) => {
    const built = buildStep(
      `step-${index}`,
      step.label,
      step.success ? "ACTIVE" : "FAILED",
      browserStepNote(step),
    );
    return isBrowserTailLabel(step.label) ? { ...built, kind: "tail" as const } : built;
  });
  const browserSummary =
    card !== undefined
      ? browserSummaryFor(steps, {
          consoleErrorCount: card.consoleErrorCount,
          pageErrorCount: card.pageErrorCount,
          failedRequestCount: card.failedRequestCount,
        })
      : undefined;

  const closing =
    phase === "running"
      ? undefined
      : phase === "failed"
        ? operationClosing("browser", "failed", {
            errorFirstLine: errorInfo !== undefined ? firstLine(errorInfo.message) : undefined,
          })
        : phase === "done"
          ? card !== undefined
            ? operationClosing("browser", "done", {
                url: card.url,
                consoleErrorCount: card.consoleErrorCount,
                pageErrorCount: card.pageErrorCount,
                failedRequestCount: card.failedRequestCount,
              })
            : "Finished."
          : operationClosing("browser", phase, {});

  const viewport = inputViewport(call.input) ?? browserSummary?.viewport;
  const deviceName = inputDeviceName(call.input);
  const firstImage = call.images?.[0];
  const size =
    firstImage === undefined
      ? undefined
      : firstImage.width !== undefined && firstImage.height !== undefined
        ? { width: firstImage.width, height: firstImage.height }
        : firstImage.mimeType === "image/png"
          ? pngSize(firstImage.data)
          : undefined;
  const screenshot =
    firstImage !== undefined
      ? {
          src: `data:${firstImage.mimeType};base64,${firstImage.data}`,
          ...(size !== undefined ? { width: size.width, height: size.height } : {}),
        }
      : undefined;

  return {
    subject,
    kicker: `${KIND_LABEL.browser} · ${subject}`,
    voice,
    voiceSource,
    statusWord: gatedStatusWord(
      "browser",
      phase,
      card !== undefined,
      call.resultText !== undefined,
    ),
    ...(closing !== undefined ? { closing } : {}),
    ...(screenshot !== undefined ? { screenshot } : {}),
    ...(browserSummary !== undefined ? { browserSummary } : {}),
    ...(viewport !== undefined ? { viewport } : {}),
    ...(deviceName !== undefined ? { deviceName } : {}),
    steps,
    links: [],
    hasResult: decoded.document !== undefined,
  };
}
