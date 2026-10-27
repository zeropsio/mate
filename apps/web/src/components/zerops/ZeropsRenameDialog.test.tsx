/**
 * A rename whose write waits on a door (M04, e2e 2026-10-03): the form allows dismissal and prevents another rename while the
 * answer comes and says a refusal where the press was made.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsRenameForm } from "./ZeropsRenameDialog";

type FormProps = Parameters<typeof ZeropsRenameForm>[0];

function form(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsRenameForm
        initialValue="Shop"
        label="Project name"
        onCancel={() => {}}
        onSubmit={() => {}}
        submitLabel="Rename"
        title="Rename the project"
        validate={() => undefined}
        {...props}
      />
    </Dialog>
  );
}

describe("ZeropsRenameForm", () => {
  it("says the refusal in the dialog", () => {
    const html = renderToStaticMarkup(form({ error: "HQ did not answer." }));
    expect(html).toMatch(/role="alert"[^>]*>HQ did not answer\.</u);
  });

  it("allows dismissal and prevents another rename while the answer comes", () => {
    const html = renderToStaticMarkup(form({ pending: true }));
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancel/u);
    expect(html).toMatch(/<button type="submit"[^>]*aria-busy="true"/u);
  });
});
