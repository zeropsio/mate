/**
 * Deleting a project that holds nothing (E2E 2026-10-03, F5): one question, one button. While HQ
 * answers it says *Deleting…* and another delete cannot be submitted, and Cancel dismisses it; a refusal stays in the dialog.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsDeleteProjectForm } from "./ZeropsDeleteProjectForm";

type FormProps = Parameters<typeof ZeropsDeleteProjectForm>[0];

function form(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsDeleteProjectForm
        error={null}
        name="mate-rig-e2e-a"
        onCancel={() => {}}
        onConfirm={() => {}}
        pending={false}
        contents={{ empty: true, deletingProjectIds: [] }}
        {...props}
      />
    </Dialog>
  );
}

const buttons = (html: string) =>
  [...html.matchAll(/<button([^>]*)>(.*?)<\/button>/gsu)].map(([, attributes, body]) => ({
    disabled: /\sdisabled=""/u.test(attributes ?? ""),
    text: (body ?? "").replace(/<[^>]+>/gu, "|"),
  }));

describe("ZeropsDeleteProjectForm", () => {
  it.each([
    ["unknown", undefined],
    ["held", { empty: false, deletingProjectIds: [] }],
    ["deleting", { empty: false, deletingProjectIds: ["zed"] }],
  ] as const)("does not claim emptiness or submit while HQ says %s", (_state, contents) => {
    const html = renderToStaticMarkup(form({ contents }));
    expect(html).not.toContain("It holds no Mate and no change.");
    expect(buttons(html).find((b) => b.text.includes("Delete"))?.disabled).toBe(true);
  });

  it("asks once, saying what goes and what stays", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain("Delete mate-rig-e2e-a?");
    expect(html).toContain(
      "It holds no Mate and no change. Its name becomes free for another project.",
    );
    expect(buttons(html).map((button) => button.disabled)).toEqual([false, false]);
    // Delete, in red: a verb that takes something away for good.
    expect(html).toMatch(
      /bg-destructive[^>]*data-zerops-surface="delete-project-confirm"[^>]*>.*?>Delete</su,
    );
  });

  it("says Deleting… while HQ answers, and allows dismissal and prevents another delete", () => {
    const html = renderToStaticMarkup(form({ pending: true }));
    expect(html).toContain("Deleting…");
    expect(buttons(html).map((button) => button.disabled)).toEqual([false, true]);
  });

  it("says HQ's refusal under the question", () => {
    const html = renderToStaticMarkup(form({ error: "This project is no longer empty." }));
    expect(html).toMatch(/role="alert"[^>]*>This project is no longer empty\.</u);
    expect(html).not.toContain("It holds no Mate and no change.");
  });
});
