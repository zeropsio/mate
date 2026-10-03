import type { ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mateRunsToRecord } from "./useMateRunsRecord";

const instance = (driver: string, overrides: Partial<ServerProvider> = {}) =>
  ({
    driver,
    instanceId: driver,
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    models: [{ slug: "m" }],
    ...overrides,
  }) as unknown as ServerProvider;

// The first client to find a Mate ready on an agent Mate signs nobody in to records it on the
// project (`mate:runs:<driver>`), once; every surface then reads whose Mate it is off its tags.
describe("mateRunsToRecord", () => {
  it.each([
    {
      name: "a ready Cursor, nothing recorded",
      recorded: false,
      providers: [instance("cursor")],
      driver: "cursor",
    },
    {
      name: "the first ready one in the server's order",
      recorded: false,
      providers: [
        instance("claudeAgent"),
        instance("grok", { status: "error" }),
        instance("opencode"),
      ],
      driver: "opencode",
    },
    {
      name: "already recorded",
      recorded: true,
      providers: [instance("cursor")],
      driver: undefined,
    },
    {
      name: "only Claude Code ready",
      recorded: false,
      providers: [instance("claudeAgent")],
      driver: undefined,
    },
    {
      name: "a Cursor whose sign-in is unknown",
      recorded: false,
      providers: [instance("cursor", { auth: { status: "unknown" } })],
      driver: undefined,
    },
    {
      name: "its providers not read yet",
      recorded: false,
      providers: undefined,
      driver: undefined,
    },
  ])("$name: $driver", ({ recorded, providers, driver }) => {
    expect(mateRunsToRecord({ recorded, providers })).toBe(driver);
  });
});
