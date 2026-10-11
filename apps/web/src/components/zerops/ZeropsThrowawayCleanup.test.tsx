import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { throwawayCleanupSpeaks, ZeropsThrowawayCleanup } from "./ZeropsThrowawayCleanup";
import type { ThrowawaySweepView } from "../../zerops/useZeropsThrowawaySweep";

describe("ZeropsThrowawayCleanup", () => {
  it.each<ThrowawaySweepView["state"]>(["idle", "waiting", "running", "done", "failed", "unknown"])(
    "shows %s with the next action",
    (state) => {
      const html = renderToStaticMarkup(
        <ZeropsThrowawayCleanup
          view={{
            state,
            failure: state === "failed" || state === "unknown" ? "Zerops did not answer." : null,
            again: () => {},
          }}
        />,
      );
      if (state === "failed" || state === "unknown") {
        expect(html).toContain("Zerops did not answer.");
        expect(html).toContain("Delete again");
        if (state === "unknown") expect(html).toContain("Sign-in cleanup outcome unknown.");
        expect(html).toContain('role="alert"');
      } else if (state === "running" || state === "waiting") {
        expect(html).toContain(
          state === "running" ? "Cleaning up sign-in tokens…" : "Sign-in cleanup queued.",
        );
        expect(html).toContain("disabled");
      } else {
        expect(html).toContain("Clean up sign-in tokens");
        if (state === "done") expect(html).toContain("Sign-in cleanup finished.");
      }
    },
  );

  // Housekeeping that goes as it should says nothing over the overview's cards: the person's own
  // cleanup is their account menu's. A cleanup that failed waits on them, so it stays in view.
  it.each([
    { state: "idle", speaks: false },
    { state: "waiting", speaks: false },
    { state: "running", speaks: false },
    { state: "done", speaks: false },
    { state: "failed", speaks: true },
    { state: "unknown", speaks: true },
  ] as const)(
    "speaks over the cards only once it needs the person: $state",
    ({ state, speaks }) => {
      expect(throwawayCleanupSpeaks(state)).toBe(speaks);
    },
  );
});
