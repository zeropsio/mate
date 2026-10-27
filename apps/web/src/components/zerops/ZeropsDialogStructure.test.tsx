/**
 * Seven Zerops dialogs used to put `DialogHeader` and/or `DialogFooter`
 * *inside* `DialogPanel` (sometimes inside a `<form>` inside the panel).
 * `DialogPanel` already carries `p-6`, so the header/footer picked up a
 * second, unwanted `p-6` — the title sat 24px right of the body text, and
 * the default footer's tinted `border-t bg-muted/72` box rendered as an
 * inset card inside the panel instead of the popup's own bottom bar.
 *
 * The canonical shape (see `CustomSnoozeDialog.tsx`,
 * `PullRequestThreadDialog.tsx`) is `DialogPopup` > `DialogHeader`,
 * `DialogPanel`, `DialogFooter` as siblings, so this asserts exactly that
 * for the content each dialog puts inside its `DialogPopup`. It renders that
 * content wrapped in a bare `Dialog` (not `DialogPopup`): `DialogPopup`
 * portals into `document`, which the `node` test environment does not have.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsAssignMateForm } from "./ZeropsAssignMateDialog";
import { ZeropsAskConfirm } from "./ZeropsAskDialog";
import { ZeropsChangeFaceForm } from "./ZeropsChangeFaceDialog";
import { ZeropsEnvironmentCreationForm } from "./ZeropsEnvironmentCreationDialog";
import { ZeropsMoveToGroupForm } from "./ZeropsMoveToGroupDialog";
import { ZeropsRenameForm } from "./ZeropsRenameDialog";

const noop = () => {};

/**
 * Pulls the first balanced element carrying `data-slot="<slot>"` out of a
 * server-rendered HTML string, so a test can check what does and does not
 * nest inside it without pulling in a DOM parser.
 */
function extractSlot(html: string, slot: string): string | undefined {
  const openTag = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*data-slot="${slot}"[^>]*>`, "i").exec(html);
  if (!openTag) return undefined;
  const tagName = openTag[1]!;
  const boundary = new RegExp(`<${tagName}(?=[ >])|</${tagName}>`, "gi");
  boundary.lastIndex = openTag.index + openTag[0].length;
  let depth = 1;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(html))) {
    depth += match[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(openTag.index, boundary.lastIndex);
  }
  throw new Error(`unbalanced <${tagName}> for data-slot="${slot}"`);
}

function renderInDialog(children: React.ReactNode): string {
  return renderToStaticMarkup(
    <Dialog open onOpenChange={noop}>
      {children}
    </Dialog>,
  );
}

const cases: ReadonlyArray<{ readonly name: string; readonly render: () => string }> = [
  {
    name: "ZeropsAssignMateDialog",
    render: () =>
      renderInDialog(
        <ZeropsAssignMateForm
          error={null}
          candidates={[{ userId: "u1", clientUserId: "cu1", name: "Ada", avatarUrl: null }]}
          onCancel={noop}
          onSubmit={noop}
          pending={false}
          projectName="Acme Docs"
        />,
      ),
  },
  {
    name: "ZeropsAskDialog",
    render: () =>
      renderInDialog(
        <ZeropsAskConfirm
          ask="Fix the flaky test"
          mateName="Theo"
          onConfirm={noop}
          sending={false}
          tint={undefined}
          what="The build is red."
        />,
      ),
  },
  {
    name: "ZeropsChangeFaceDialog",
    render: () =>
      renderInDialog(
        <ZeropsChangeFaceForm
          error={null}
          face={{ tint: "olive", shape: "clover" }}
          name="Fen"
          onCancel={noop}
          onSave={noop}
          pending={false}
        />,
      ),
  },
  {
    name: "ZeropsEnvironmentCreationDialog",
    render: () =>
      renderInDialog(
        <ZeropsEnvironmentCreationForm
          defaultName="Acme Docs - stage"
          defaultTintFor={() => "violet"}
          defaultWithAgent
          groupName="Acme Docs"
          onCancel={noop}
          onCreate={noop}
          role="stage"
          takenBotNames={{ names: [], complete: true }}
          tier={undefined}
          recipe="absent"
          tierServices={[]}
        />,
      ),
  },
  {
    name: "ZeropsEnvironmentCreationDialog, for a Mate",
    render: () =>
      renderInDialog(
        <ZeropsEnvironmentCreationForm
          defaultName="Otto"
          defaultTintFor={() => "violet"}
          defaultWithAgent
          groupName="Acme Docs"
          onCancel={noop}
          onCreate={noop}
          role="dev"
          takenBotNames={{ names: [], complete: true }}
          tier={undefined}
          recipe="absent"
          tierServices={[]}
        />,
      ),
  },
  {
    name: "ZeropsMoveToGroupDialog",
    render: () =>
      renderInDialog(
        <ZeropsMoveToGroupForm
          currentGroupId={undefined}
          currentRole={undefined}
          choices={{
            apps: [{ id: "g1", name: "Acme Docs", roles: ["dev", "stage", "prod"] }],
            newApp: ["dev", "stage", "prod"],
            none: true,
          }}
          onCancel={noop}
          name="Fen"
          onSubmit={noop}
        />,
      ),
  },
  {
    name: "ZeropsRenameDialog",
    render: () =>
      renderInDialog(
        <ZeropsRenameForm
          initialValue="Fen"
          label="Name"
          onCancel={noop}
          onSubmit={noop}
          submitLabel="Rename"
          title="Rename Fen"
          validate={() => undefined}
        />,
      ),
  },
];

describe.each(Array.from(cases, (dialogCase) => ({ title: dialogCase.name, dialogCase })))(
  "$title",
  ({ dialogCase }) => {
    it("keeps the header and footer out of the scrollable panel", () => {
      const html = dialogCase.render();

      const header = extractSlot(html, "dialog-header");
      const panel = extractSlot(html, "dialog-panel");
      const footer = extractSlot(html, "dialog-footer");

      expect(header, "dialog-header should render").toBeDefined();
      expect(panel, "dialog-panel should render").toBeDefined();
      expect(footer, "dialog-footer should render").toBeDefined();

      expect(panel).not.toContain('data-slot="dialog-header"');
      expect(panel).not.toContain('data-slot="dialog-footer"');
    });
  },
);
