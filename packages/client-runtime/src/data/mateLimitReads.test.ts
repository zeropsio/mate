import { TurnId } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { createMateLimitAtoms } from "./mateLimitReads.ts";
import type { MateLimitSource } from "./projections/mateLimit.ts";

it.each([false, true])(
  "every reader sees a parked refusal expire at its provider deadline without another delivery",
  async (typed) => {
    vi.useFakeTimers();
    const startedAt = "2026-10-08T10:00:00.000Z";
    vi.setSystemTime(Date.parse(startedAt));
    const source: MateLimitSource = {
      latestTurn: { turnId: "refused", state: "running", startedAt, completedAt: null },
      session: {
        lastError: "You've hit your weekly limit",
        providerName: "claudeAgent",
        usageLimitResetAt: "2026-10-08T10:00:01.000Z",
        updatedAt: startedAt,
      },
    };
    const evidence: MateLimitSource = typed
      ? {
          ...source,
          refusal: {
            turnId: TurnId.make("refused"),
            provider: "Claude",
            resetsAt: "2026-10-08T10:00:01.000Z",
          },
        }
      : source;
    const sources = Atom.make<MateLimitSource | null>(evidence);
    const readings = createMateLimitAtoms(() => sources);
    const registry = AtomRegistry.make();
    const reading = readings("Ada:refused");
    const release = registry.subscribe(reading, () => {}, { immediate: true });
    try {
      expect(registry.get(reading).kind).toBe("limited");
      await vi.advanceTimersByTimeAsync(999);
      expect(registry.get(reading).kind).toBe("limited");
      await vi.advanceTimersByTimeAsync(1);
      expect(registry.get(reading).kind).toBe("expired");
      registry.set(sources, {
        ...evidence,
        ...(typed ? { refusal: null } : {}),
        latestTurn: {
          ...source.latestTurn!,
          turnId: "admitted",
          startedAt: "2026-10-08T10:00:02.000Z",
        },
      });
      expect(registry.get(reading).kind).toBe("none");
    } finally {
      release();
      registry.dispose();
      vi.useRealTimers();
    }
  },
);
