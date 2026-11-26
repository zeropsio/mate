import { CircleCheckIcon, PanelRightIcon } from "lucide-react";

import { Badge, type BadgeTone } from "~/components/ui/badge";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, SpecimenMatrix, Specimens } from "../Specimen";
import { variantsOf } from "../specimenLabel";

const TONES = variantsOf<BadgeTone>({
  neutral: true,
  info: true,
  success: true,
  warning: true,
  danger: true,
});

const WORDS: Readonly<Record<BadgeTone, string>> = {
  neutral: "Stopped",
  info: "Deploying",
  success: "Running",
  warning: "Needs you",
  danger: "Failed",
};

function BadgeSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="A pill label, or a dot before its words." title="Tones and forms">
        <SpecimenMatrix
          rowProp="tone"
          rows={TONES}
          columnProp="form"
          columns={["pill", "dot", "dot in a sentence"] as const}
          columnLabel={(form) =>
            form === "pill" ? "(pill)" : form === "dot" ? "dot" : "dot, in a sentence"
          }
          render={(tone, form) =>
            form === "pill" ? (
              <Badge tone={tone}>{WORDS[tone]}</Badge>
            ) : form === "dot" ? (
              <Badge dot tone={tone}>
                {WORDS[tone]}
              </Badge>
            ) : (
              <span className="text-body text-muted-foreground">
                Stage is{" "}
                <Badge dot tone={tone}>
                  {WORDS[tone].toLowerCase()}
                </Badge>{" "}
                · main
              </span>
            )
          }
        />
      </SpecimenBlock>
      <SpecimenBlock title="Marks, counts and long words">
        <SpecimenGrid size="md">
          <Specimen
            label='dot aria-label="Running"'
            note="A dot alone, in a row too narrow for words"
          >
            <Badge aria-label="Running" dot tone="success" />
          </Specimen>
          <Specimen label="dot hollow" note="Nothing there yet, or stopped on purpose">
            <Badge dot hollow>
              Stopped
            </Badge>
          </Specimen>
          <Specimen label='door tone="warning"' note="Opens what it names; hover it">
            <Badge door tone="warning">
              Release · 2
            </Badge>
          </Specimen>
          <Specimen
            label='tone="success" · <CircleCheckIcon /> first'
            note="An icon before its words"
          >
            <Badge tone="success">
              <CircleCheckIcon />
              Running
            </Badge>
          </Specimen>
          <Specimen label="count" note="A count beside a title">
            <span className="flex items-center gap-2 font-medium text-body">
              Changes
              <Badge count>12</Badge>
            </span>
          </Specimen>
          <Specimen label='count tone="info"' note="How many are at work">
            <span className="flex items-center gap-2 font-medium text-body">
              Working
              <Badge count tone="info">
                3
              </Badge>
            </span>
          </Specimen>
          <Specimen label='count corner tone="info"' note="A count on a control's corner">
            <span className="relative inline-flex size-8 items-center justify-center rounded-control bg-muted text-muted-foreground">
              <PanelRightIcon aria-hidden="true" className="size-4" />
              <Badge corner count tone="info">
                2
              </Badge>
            </span>
          </Specimen>
          <Specimen
            label='className="max-w-full" · <span className="truncate">'
            note="A long name in a 128 px box, cut the way its caller cuts it"
          >
            <div className="flex w-32">
              <Badge className="max-w-full">
                <span className="truncate">storefront-preview-eu-central-2</span>
              </Badge>
            </div>
          </Specimen>
          <Specimen label='render={<a href="#badge" />}' note="A badge that is a link">
            <Badge render={<a href="#badge" />}>storefront</Badge>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "badge",
  title: "Badge",
  purpose:
    "The one label: a short word or count beside what it describes, a pill so it never reads as a press. Five tones carry meaning (neutral, info, success, warning, danger); the dot form is a status mark that always has its words or an accessible name.",
  group: "Chosen",
  kind: "Labels",
  source: "apps/web/src/components/ui/badge.tsx",
  render: () => <BadgeSpecimens />,
});
