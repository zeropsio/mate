import { KeyRoundIcon } from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { MateFace, PersonAvatar } from "~/components/zerops/primitives";

import { definePlayground, jsxElement } from "../kitPlayground";
import { variantsOf } from "../specimenLabel";

const SIZES = variantsOf<NonNullable<ComponentProps<typeof PageHeader>["size"]>>({
  page: true,
  panel: true,
});
/** The mark before the title: a person's page, a Mate's, a page with an icon of its own. */
const LEADS = ["none", "person", "mate", "icon"] as const;
const ACTIONS = ["none", "one", "two"] as const;

const LEAD_JSX: Readonly<Record<(typeof LEADS)[number], string | undefined>> = {
  none: undefined,
  person: 'lead={<PersonAvatar name="Petra Malá" size={64} />}',
  mate: 'lead={<MateFace size={64} state="idle" tint="olive" />}',
  icon: "lead={<KeyRoundIcon />}",
};

export default definePlayground({
  section: "page-header",
  name: "PageHeader",
  imports: 'import { PageHeader } from "~/components/ui/page-header";',
  controls: {
    size: {
      kind: "enum",
      options: SIZES,
      note: "panel: a side panel's page, its line kept to one",
    },
    title: { kind: "text", note: "what the page is, in the words that opened it" },
    count: { kind: "text", note: "how many things it lists, after the title" },
    line: { kind: "text", note: "what the page is for, or the fact it is about" },
    lead: { kind: "enum", options: LEADS, note: "a mark before the title" },
    actions: { kind: "enum", options: ACTIONS, note: "the page's own, at the title line's end" },
  },
  initial: {
    size: "page",
    title: "Team",
    count: "3",
    line: "People who work on Acme Docs and its Mates",
    lead: "none",
    actions: "one",
  },
  render: ({ size, title, count, line, lead, actions }) => (
    <div className={size === "panel" ? "w-[33.75rem] border border-border pb-3" : "w-[44rem]"}>
      <PageHeader
        actions={
          actions === "none" ? undefined : actions === "one" ? (
            <Button size="sm">Invite people</Button>
          ) : (
            <>
              <Button size="sm" variant="ghost">
                Copy the link
              </Button>
              <Button size="sm">Invite people</Button>
            </>
          )
        }
        count={count === "" ? undefined : count}
        lead={
          lead === "person" ? (
            <PersonAvatar name="Petra Malá" size={64} />
          ) : lead === "mate" ? (
            <MateFace size={64} state="idle" tint="olive" />
          ) : lead === "icon" ? (
            <KeyRoundIcon />
          ) : undefined
        }
        line={line === "" ? undefined : line}
        size={size}
        title={title}
      />
    </div>
  ),
  jsx: ({ size, title, count, line, lead, actions }) => {
    const leadProp = LEAD_JSX[lead];
    return jsxElement(
      "PageHeader",
      {
        size,
        ...(leadProp === undefined ? {} : { [leadProp]: true }),
        title,
        count: count === "" ? undefined : count,
        line: line === "" ? undefined : line,
        'actions={<Button size="sm">Invite people</Button>}': actions === "one" ? true : undefined,
        "actions={<>…</>}": actions === "two" ? true : undefined,
      },
      undefined,
      { size: "page" },
    );
  },
  usage: {
    do: [
      "Head every page with it, once: title, count, one line, the page's actions.",
      "Lead with the face or avatar the page is about: a Mate's page, a person's.",
      "Use size panel for a page in the side panel.",
    ],
    dont: [
      "Put more than one line under the title: the page says the rest.",
      "Put a primary press in the head of a page whose next step is in its body.",
      "Use it for a group of rows on the page: that is a Section.",
    ],
  },
});
