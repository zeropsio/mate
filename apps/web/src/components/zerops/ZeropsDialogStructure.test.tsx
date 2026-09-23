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
 * content wrapped in a bare `Dialog` (not `DialogPopup`), the same way
 * `ZeropsMergeDialog.test.tsx` / `ZeropsReleaseDialog.test.tsx` already do —
 * `DialogPopup` portals into `document`, which the `node` test environment
 * does not have.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Dialog } from "../ui/dialog";
import { ZeropsAssignMateForm } from "./ZeropsAssignMateDialog";
import { ZeropsAskConfirm } from "./ZeropsAskDialog";
import { ZeropsEnvironmentCreationForm } from "./ZeropsEnvironmentCreationDialog";
import { ZeropsMergeConfirm } from "./ZeropsMergeDialog";
import { ZeropsMoveToGroupForm } from "./ZeropsMoveToGroupDialog";
import { ZeropsRenameForm } from "./ZeropsRenameDialog";
import { ZeropsReleaseConfirm } from "./ZeropsReleaseDialog";

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

const pull = {
  repository: "appdev",
  number: 5,
  title: "Cache the link previews",
  kind: "code" as const,
  mateProjectId: "p-theo",
  author: "mate-p-theo",
  url: undefined,
  checks: "passing" as const,
  checkWord: "checks passed",
  mergeable: true,
  merged: false,
  mergedAt: undefined,
  headSha: "b21d904c",
  baseBranch: "main",
  line: "appdev #5",
  updatedAt: undefined,
};

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
          members={[{ id: "u1", user: { fullName: "Ada" } }]}
          onCancel={noop}
          onSubmit={noop}
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
    name: "ZeropsEnvironmentCreationDialog",
    render: () =>
      renderInDialog(
        <ZeropsEnvironmentCreationForm
          defaultBotName="Otto"
          defaultName="Acme Docs - stage"
          defaultWithAgent
          groupName="Acme Docs"
          onCancel={noop}
          onCreate={noop}
          role="stage"
          takenBotNames={[]}
          tier={undefined}
          tierLoading={false}
          tierServices={[]}
        />,
      ),
  },
  {
    name: "ZeropsMergeDialog",
    render: () =>
      renderInDialog(
        <ZeropsMergeConfirm mateName="Theo" merging={false} onConfirm={noop} pull={pull} />,
      ),
  },
  {
    name: "ZeropsMoveToGroupDialog",
    render: () =>
      renderInDialog(
        <ZeropsMoveToGroupForm
          currentGroupId={undefined}
          currentRole={undefined}
          groups={[{ id: "g1", name: "Acme Docs" }]}
          mintGroupId={() => "new-group"}
          onCancel={noop}
          onSubmit={noop}
          projectName="Acme Docs - stage"
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
  {
    name: "ZeropsReleaseDialog",
    render: () =>
      renderInDialog(
        <ZeropsReleaseConfirm
          contents={[{ commits: [{ sha: "a", subject: "Add a search box above the list" }] }]}
          onConfirm={noop}
          releasing={false}
          tag="v0.1.3"
        />,
      ),
  },
];

for (const dialogCase of cases) {
  describe(dialogCase.name, () => {
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
  });
}
