/**
 * Handing a Mate over (E2E F8): the list is the people HQ answers, and nobody is picked until the
 * person picks — pressing *Hand it over* without looking once handed a Mate to a token.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsAssignMateForm } from "./ZeropsAssignMateDialog";

type FormProps = Parameters<typeof ZeropsAssignMateForm>[0];

const ADA = { userId: "u-ada", clientUserId: "cu-ada", name: "Ada Lovelace", avatarUrl: null };
const EVA = { userId: "u-eva", clientUserId: "cu-eva", name: "Eva Dvořák", avatarUrl: null };

function form(props: Partial<FormProps> = {}): ReactElement {
  // The title and the description are Base UI's, and both need the dialog's context.
  return (
    <Dialog open onOpenChange={() => {}}>
      <ZeropsAssignMateForm
        candidates={[ADA, EVA]}
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
  it("lists the people HQ answers, each by name, picked by their member id", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toContain('value="cu-ada"');
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('value="cu-eva"');
    expect(html).toContain("Eva Dvořák");
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

  // F27: whom to hand over to is asked once the dialog opens, and KRLS's took seconds.
  it("says it reads the organization while there is nobody to pick yet", () => {
    const html = renderToStaticMarkup(form({ candidates: [], readingOrganization: "Acme" }));
    expect(html).toMatch(/<select(?=[^>]*aria-busy="true")(?=[^>]*disabled="")/u);
    expect(html).toMatch(/<option(?=[^>]*selected="")[^>]*>Reading Acme…<\/option>/u);
  });

  it("says it could not read the organization's people, with the way to read them again", () => {
    const html = renderToStaticMarkup(
      form({ candidates: [], readFailed: { organization: "Acme", onReadAgain: () => {} } }),
    );
    expect(html).toMatch(
      /role="alert"[^>]*>Couldn(&#x27;|')t read Acme(&#x27;|')s members from Zerops\.</u,
    );
    expect(html).toMatch(/<button[^>]*>Try again<\/button>/u);
  });

  // HQ's definitive refusal is its word, not a read to try again.
  it("says HQ refused to list the organization's people, with no Try again", () => {
    const html = renderToStaticMarkup(
      form({ candidates: [], readRefused: { organization: "Acme" } }),
    );
    expect(html).toMatch(/role="alert"[^>]*>HQ refused to list Acme(&#x27;|')s people\.</u);
    expect(html).not.toContain("Try again");
  });

  it("picks nobody: the hand-over waits on the person's own pick", () => {
    const html = renderToStaticMarkup(form());
    expect(html).toMatch(/<option(?=[^>]*selected="")[^>]*>Pick a person<\/option>/u);
    expect(html).not.toMatch(/<option(?=[^>]*selected="")[^>]*value="cu-/u);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Hand it over/u);
  });
});
