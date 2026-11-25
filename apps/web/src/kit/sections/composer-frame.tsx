import { ArrowUpIcon, LockIcon } from "lucide-react";

import { Button } from "~/components/ui/button";
import { ComposerFrame } from "~/components/ui/composer-frame";
import { Text } from "~/components/ui/text";
import { Textarea } from "~/components/ui/textarea";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

/** A tell's frame as a tab's top holds it: its words, and the round send at its end. */
export function SampleTell({ placeholder }: { readonly placeholder: string }) {
  return (
    <ComposerFrame className="w-full">
      <Textarea
        aria-label={placeholder}
        className="flex-1"
        placeholder={placeholder}
        rows={1}
        size="line"
      />
      <Button aria-label="Send" shape="round" size="icon-sm">
        <ArrowUpIcon />
      </Button>
    </ComposerFrame>
  );
}

function ComposerFrameSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock
        note="The one white surface where the person acts; its edge firms while the caret is inside."
        title="Sizes"
      >
        <SpecimenGrid size="lg">
          <Specimen label='size="sheet"' note="At the foot of a conversation or a tab">
            <SampleTell placeholder="Give the crew something to do…" />
          </Specimen>
          <Specimen label='size="card"' note="Inside a panel or a sheet: a change's comment">
            <ComposerFrame className="w-full" size="card">
              <Textarea
                aria-label="Comment on this change"
                className="flex-1"
                placeholder="Comment on this change…"
                rows={1}
                size="line"
              />
              <Button size="sm" variant="ghost">
                Comment
              </Button>
            </ComposerFrame>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Nothing can be written here now: why, in the frame's own room, and the one way out."
        title="Locked"
      >
        <SpecimenGrid size="lg">
          <Specimen label="locked" note="A crew the viewer may not run">
            <ComposerFrame className="w-full" locked>
              <LockIcon aria-hidden="true" className="size-4 shrink-0 text-warning" />
              <Text className="min-w-0 flex-auto" render={<p />} variant="description">
                The crew runs on Ada's logins.
              </Text>
              <Button size="sm" variant="secondary">
                Sign in
              </Button>
            </ComposerFrame>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "composer-frame",
  title: "ComposerFrame",
  purpose: "The box a message is written in: a tell, a comment, a preview of the composer's type.",
  group: "Chosen",
  kind: "Fields",
  source: "apps/web/src/components/ui/composer-frame.tsx",
  render: () => <ComposerFrameSpecimens />,
});
