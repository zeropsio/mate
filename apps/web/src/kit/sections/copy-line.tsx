import { CopyLine } from "~/components/ui/copy-line";
import { Text } from "~/components/ui/text";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export default defineKitSection({
  id: "copy-line",
  title: "CopyLine",
  purpose: "One value to copy on a line of its own: a command, a path, an address.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/copy-line.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="Cut with an ellipsis, or wrapped where it is read whole." title="Forms">
        <SpecimenGrid size="md">
          <Specimen label='label="the payload URL"' note="An address to hand another service">
            <CopyLine
              className="w-full"
              label="the payload URL"
              value="https://hq.example.com/hooks/github/4f1c2a9e-77b3-4c1e-9a0d-5be0c2f1aa31"
            />
          </Specimen>
          <Specimen label='label="the command" wrap' note="A command read before it runs">
            <CopyLine
              className="w-full"
              label="the command"
              value="brew install wireguard-tools && sudo zcli vpn up --project-id 5Hx2KqA9TfW"
              wrap
            />
          </Specimen>
          <Specimen label="value={null}" note="Being read: the room held, Copy waits">
            <CopyLine className="w-full" label="the address" value={null} />
          </Specimen>
          <Specimen label='value={null} placeholder="…"' note="Not made yet: words in its room">
            <CopyLine
              className="w-full"
              label="the address"
              placeholder="Made when you save the app's keys"
              value={null}
            />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="The place's own label names it, over or beside it." title="Named">
        <SpecimenGrid size="md">
          <Specimen label={'<Text variant="heading"> over'} note="An address field">
            <div className="grid w-full gap-1.5">
              <Text render={<p />} variant="heading">
                Callback URL
              </Text>
              <CopyLine label="the callback URL" value="https://mate.example.com/oauth/callback" />
            </div>
          </Specimen>
          <Specimen label='<Text variant="label"> beside' note="A webhook's lines">
            <div className="grid w-full grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
              <Text variant="label">Payload URL</Text>
              <CopyLine label="the payload URL" value="https://hq.example.com/hooks/abc" />
              <Text variant="label">Secret</Text>
              <CopyLine label="the secret" value="whsec_9f3b1c7d2e8a4f60" />
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
