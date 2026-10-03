import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsMoveToGroupForm } from "./ZeropsMoveToGroupDialog";

const noop = () => {};

/** The form as the dialog draws it, its first choice picked. */
const drawn = (target: { readonly groupId: string | undefined }) =>
  renderToStaticMarkup(
    <Dialog open onOpenChange={noop}>
      <ZeropsMoveToGroupForm
        choices={{
          apps: [{ id: "acme", name: "Acme Docs", roles: ["dev", "stage", "prod"] }],
          newApp: ["dev", "stage", "prod"],
          none: true,
        }}
        currentGroupId={target.groupId}
        currentRole={undefined}
        name="Fen"
        onCancel={noop}
        onSubmit={noop}
      />
    </Dialog>,
  );

// e2e-krls F29: the menu offers "Move to project…", and the dialog spoke of groups.
describe("ZeropsMoveToGroupForm — in the words of the menu that opens it", () => {
  it("calls an application a project, never a group", () => {
    // What it says, without its markup's own names (a radio group is one).
    const said = drawn({ groupId: "acme" })
      .replace(/<style[^]*?<\/style>/gu, " ")
      .replace(/<[^>]*>/gu, " ");

    expect(said).toContain("Move Fen");
    expect(said).toMatch(/\bProject\b/u);
    expect(said).toContain("New project");
    expect(said).toContain("No project");
    expect(said).not.toMatch(/group/iu);
  });
});
