import { useState, type ReactNode } from "react";

import { Collapsible, CollapsiblePanel } from "~/components/ui/collapsible";
import { SectionAction, SectionLabel } from "~/components/zerops/system/SectionLabel";

import { definePlayground, jsxCode, jsxElement } from "../kitPlayground";

/** Its heading's level: 2 on a page, 3 inside a sheet or a panel. */
const LEVELS = ["2", "3"] as const;

/** A folding label opens what it names; the playground holds whether it is open. */
function Folding({ children, label }: { readonly children: ReactNode; readonly label: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      {label}
      <CollapsiblePanel className="mt-3">{children}</CollapsiblePanel>
    </Collapsible>
  );
}

export default definePlayground({
  section: "section-label",
  name: "SectionLabel",
  imports: 'import { SectionAction, SectionLabel } from "~/components/zerops/system/SectionLabel";',
  controls: {
    label: { kind: "text", note: "names what is under it, sentence case" },
    count: { kind: "text", note: "how many, or a short fact, after a dot" },
    action: { kind: "text", note: "its one action at the line's end; empty: none" },
    folds: { kind: "boolean", note: "opens and shuts the Collapsible it stands in" },
    level: { kind: "enum", options: LEVELS, note: "3 inside a sheet or a panel" },
  },
  initial: { label: "Files", count: "3 changed", action: "", folds: true, level: "3" },
  render: ({ label, count, action, folds, level }) => {
    const said = (
      <SectionLabel
        action={action === "" ? undefined : <SectionAction>{action}</SectionAction>}
        count={count === "" ? undefined : count}
        folds={folds}
        level={level === "3" ? 3 : 2}
      >
        {label}
      </SectionLabel>
    );
    const under = <p className="m-0 text-body">src/status.ts, src/routes.ts and .nvmrc changed.</p>;
    return (
      <div className="w-[28rem]">
        {folds ? (
          <Folding label={said}>{under}</Folding>
        ) : (
          <>
            {said}
            {under}
          </>
        )}
      </div>
    );
  },
  jsx: ({ label, count, action, folds, level }) => {
    const said = jsxElement(
      "SectionLabel",
      {
        action: action === "" ? undefined : jsxCode(`<SectionAction>${action}</SectionAction>`),
        count: count === "" ? undefined : count,
        folds,
        level: level === "3" ? 3 : undefined,
      },
      label,
      { folds: false },
    );
    return folds
      ? jsxElement("Collapsible", {}, `${said}\n<CollapsiblePanel>…</CollapsiblePanel>`)
      : said;
  },
  usage: {
    do: [
      "Label a group on a page or in a panel: sentence case, muted, hugging what it names.",
      "Say a count or a short fact after its dot, beside the words, never at the far edge.",
      "Fold a long section shut with folds, inside a Collapsible: the words are the press.",
      "Put the section's own state at the line's end, where its one action would stand.",
    ],
    dont: [
      "Head a page or a sheet's sections with a title: that is SectionHeader.",
      "Give it more than one action, or a primary press.",
    ],
  },
});
