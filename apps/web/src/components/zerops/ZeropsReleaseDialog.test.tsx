import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsReleaseConfirm } from "./ZeropsReleaseDialog";

const change = (subject: string, sha: string) => ({ commits: [{ sha, subject }] });

function render(props: Partial<Parameters<typeof ZeropsReleaseConfirm>[0]> = {}) {
  // The title and the way out are Base UI's, and both need the root's context.
  return renderToStaticMarkup(
    <Dialog open onOpenChange={() => {}}>
      <ZeropsReleaseConfirm
        contents={[change("Add a search box above the list", "a")]}
        onConfirm={() => {}}
        releasing={false}
        tag="v0.1.3"
        {...props}
      />
    </Dialog>,
  );
}

describe("the release confirm", () => {
  it("names the version it would cut, so the tag is not a surprise", () => {
    expect(render()).toContain("Release v0.1.3");
  });

  it("spells out what goes live, rather than leaving it in a hover", () => {
    // The list used to live in a tooltip, which a keyboard and a phone do not
    // have — and the tag was cut on one click.
    const html = render({
      contents: [change("Add a search box above the list", "a"), change("Rename the app", "b")],
    });
    expect(html).toContain('data-zerops-surface="release-confirm-contents"');
    expect(html).toContain("Add a search box above the list");
    expect(html).toContain("Rename the app");
    expect(html).toContain("2 changes go live.");
  });

  it("counts one change as one", () => {
    expect(render()).toContain("One change goes live.");
  });

  it("offers nothing to confirm where nothing is waiting", () => {
    const html = render({ contents: [] });
    expect(html).toContain("the production already runs what the stage does");
    expect(html).not.toContain('data-zerops-surface="release-confirm-contents"');
    // The verb is still there — disabled, so the dialog never cuts an empty tag.
    expect(html).toContain("disabled");
  });

  it("takes no second press while the first is running", () => {
    expect(render({ releasing: true })).toContain("disabled");
  });

  it("keeps a way out beside the verb", () => {
    expect(render()).toContain("Cancel");
  });
});
