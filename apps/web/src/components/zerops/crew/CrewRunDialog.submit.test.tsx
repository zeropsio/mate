// @vitest-environment happy-dom
import { crewSnapshotFixture } from "@t3tools/client-runtime/zerops/crew/testing/fixtures";
import type { CrewCommand } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { Dialog } from "~/components/ui/dialog";

import { CrewStartBody } from "./CrewRunDialog";
import { crewRunDraft } from "./CrewRunDialog.logic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

/** The dialog as a person meets it, and every command its Start sends. */
function openStart(): Array<CrewCommand> {
  const sent: Array<CrewCommand> = [];
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <Dialog defaultOpen>
        <CrewStartBody
          canAct
          error={null}
          hasLead={false}
          initial={crewRunDraft(crewSnapshotFixture().run!, false)}
          mateName="Fen"
          onCancel={() => undefined}
          onStart={(command) => sent.push(command)}
          plan="your Claude plan"
          spendBlocker={null}
        />
      </Dialog>,
    ),
  );
  return sent;
}

/** The row's own press, found by the row's words. */
function press(words: string, row?: string) {
  const buttons = [...document.querySelectorAll("button")].filter(
    (button) => button.textContent?.trim() === words,
  );
  const button =
    row === undefined
      ? buttons[0]
      : buttons.find((candidate) => candidate.parentElement?.textContent?.includes(row));
  if (button === undefined) throw new Error(`no "${words}" press${row ? ` in "${row}"` : ""}`);
  act(() => button.click());
}

describe("CrewStartBody — what Start sends", () => {
  it.each([
    {
      name: "No limit on the hours starts a run with no time limit",
      noLimit: true,
      hours: "unlimited",
    },
    { name: "the hours as shown start a run with that time limit", noLimit: false, hours: 8 },
  ] as const)("$name", ({ noLimit, hours }) => {
    const sent = openStart();
    if (noLimit) press("No limit", "Stop after");
    press("Start");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ _tag: "start", timeLimitHours: hours });
  });
});
