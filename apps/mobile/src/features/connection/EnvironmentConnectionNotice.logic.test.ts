import type { EnvironmentConnectionPresentation } from "@t3tools/client-runtime/connection";
import { describe, expect, it } from "vite-plus/test";

import { environmentConnectionNoticeCopy } from "./EnvironmentConnectionNotice.logic";

// What a zcp restart put on screen (gate CD, zcp-restart/03-during-2.png).
const RAW_ERROR =
  "Failed to fetch remote environment endpoint https://zcp-30db-8080.prg1.zerops.app/mate/.well-known/t3/environment (HttpClientError: Transport error (GET https://zcp-30db-8080.prg1.zerops.app/mate/.well-known/t3/environment)).";
const LEAKS = [
  /https?:\/\//,
  /\b[a-z0-9-]+(\.[a-z0-9-]+){2,}\b/i,
  /\b[A-Z][A-Za-z]*Error\b/,
  /Reason:/,
];

const connection = (
  phase: EnvironmentConnectionPresentation["phase"],
  error: string | null,
): EnvironmentConnectionPresentation => ({ phase, error, traceId: error ? "trace-1" : null });

describe("environmentConnectionNoticeCopy", () => {
  it.each([
    {
      name: "reconnecting after a failure",
      connection: connection("reconnecting", RAW_ERROR),
      title: "Reconnecting to Wren...",
      detail:
        "It isn't answering. It may be restarting. The diff will load as soon as the environment is ready.",
    },
    {
      name: "refused",
      connection: connection("error", RAW_ERROR),
      title: "Wren is unavailable",
      detail: "It refused the connection. Reconnect the environment to load the diff.",
    },
  ])("$name: names the cause, never the failure's words", ({ connection, title, detail }) => {
    const copy = environmentConnectionNoticeCopy({
      environmentLabel: "Wren",
      connection,
      resourceName: "diff",
    });
    expect(copy).toEqual({ title, detail });
    for (const leak of LEAKS) {
      expect(`${copy.title}\n${copy.detail}`).not.toMatch(leak);
    }
  });

  it.each([
    {
      phase: "reconnecting" as const,
      detail: "The diff will load as soon as the environment is ready.",
    },
    {
      phase: "connecting" as const,
      detail: "The diff will load as soon as the environment is ready.",
    },
    {
      phase: "offline" as const,
      detail: "Cached data remains available. The diff will load when your connection returns.",
    },
    { phase: "available" as const, detail: "Reconnect the environment to load the diff." },
  ])("$phase without a failure says what happens next", ({ phase, detail }) => {
    expect(
      environmentConnectionNoticeCopy({
        environmentLabel: "Wren",
        connection: connection(phase, null),
        resourceName: "diff",
      }).detail,
    ).toBe(detail);
  });
});
