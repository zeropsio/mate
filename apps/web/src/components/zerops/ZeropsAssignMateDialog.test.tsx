/**
 * Handing a Mate over (E2E F8): the list is the organization's people, never one of its integration
 * tokens, and nobody is picked until the person picks — pressing *Hand it over* without looking
 * once handed a Mate to a token.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsAssignMateForm } from "./ZeropsAssignMateDialog";

type FormProps = Parameters<typeof ZeropsAssignMateForm>[0];

const ADA = {
  id: "cu-ada",
  status: "ACTIVE",
  user: { fullName: "Ada Lovelace", email: "ada@example.com" },
};
const TOKEN = {
  id: "cu-token",
  status: "ACTIVE",
  user: { fullName: "zcp-laravel-showcase-agent", email: "token-abc123@zerops.io" },
};

function form(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsAssignMateForm
        members={[TOKEN, ADA]}
        onCancel={() => {}}
        onSubmit={() => {}}
        pending={false}
        error={null}
        projectName="Acme Docs"
        {...props}
      />
    </Dialog>
  );
}

describe("ZeropsAssignMateForm", () => {
  it("lists the organization's people and none of its tokens", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain('value="cu-ada"');
    expect(html).toContain("Ada Lovelace");
    expect(html).not.toContain("cu-token");
    expect(html).not.toContain("zcp-laravel-showcase-agent");
  });

  // E2E F7: a refused hand-over closed its dialog and said nothing.
  it("says the platform's refusal in the dialog", () => {
    const html = renderToStaticMarkup(form({ error: "Zerops refused the hand-over." }));
    expect(html).toMatch(/role="alert"[^>]*>Zerops refused the hand-over\.</u);
  });

  it("holds its verbs while the platform answers", () => {
    const html = renderToStaticMarkup(form({ pending: true }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel/u);
    expect(html).toMatch(/<button type="submit"[^>]*aria-busy="true"/u);
  });

  it("picks nobody: the hand-over waits on the person's own pick", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toMatch(/<option(?=[^>]*selected="")[^>]*>Pick a person<\/option>/u);
    expect(html).not.toMatch(/<option(?=[^>]*selected="")[^>]*value="cu-/u);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Hand it over/u);
  });
});
