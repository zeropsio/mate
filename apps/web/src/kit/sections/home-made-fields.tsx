import { useState } from "react";

import { ThemeJsonEditor } from "~/components/settings/ThemeImportDialog";
import { Button } from "~/components/ui/button";
import { LimitField } from "~/components/zerops/crew/CrewRunDialog";
import { CrewTextArea } from "~/components/zerops/crew/CrewView";
import { MateNameInput } from "~/components/zerops/MateNameInput";
import { MateRenameField } from "~/components/zerops/SidebarMateMenu";
import { Replying } from "~/components/zerops/SidebarWaiting";
import { VaultTextEditor } from "~/components/zerops/vault/VaultEditors";
import { vaultFixtureScope } from "~/components/zerops/vault/vaultFixture";
import { vaultToText } from "~/components/zerops/vault/vaultText.logic";

import { CensusCount, CensusLook, CensusLooks } from "../census";
import { defineKitSection } from "../kitSection";
import { Specimen } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const noop = () => {};

/** A field that is not where the menu's row is until somebody asks it to be. */
function RenameOpener() {
  const [renaming, setRenaming] = useState(false);
  if (!renaming) {
    return (
      <Button onClick={() => setRenaming(true)} size="md" variant="outline">
        Rename Fen
      </Button>
    );
  }
  return (
    <span className="flex w-56 items-center">
      <MateRenameField
        onDone={() => setRenaming(false)}
        rename={{
          initialValue: "Fen",
          validate: (value) => (value.trim().length === 0 ? "A Mate needs a name." : undefined),
          commit: noop,
        }}
      />
    </span>
  );
}

function FieldSpecimens() {
  const [goal, setGoal] = useState("Ship the storefront's checkout to stage.");
  const [name, setName] = useState("Fen");
  const [hours, setHours] = useState("8");
  const [json, setJson] = useState('{\n  "version": 1,\n  "name": "Aurora"\n}');
  const scope = vaultFixtureScope("shared");
  const [vaultText, setVaultText] = useState(() => vaultToText(scope));

  return (
    <CensusLooks>
      <CensusCount
        components={17}
        files={38}
        kit="46 raw <input>, <select> and <textarea> in 36 files, 9 of them with no look (hidden, file, checkbox, slider); the kit's Input renders in 41 files, its fields in 72"
        looks={17}
      />

      <CensusLook
        files={4}
        name="Crew fields"
        note="crew-field, in index.css: raw inputs and CrewTextArea"
        source="apps/web/src/components/zerops/crew/CrewView.tsx"
        uses={10}
      >
        {([4, 6] as const).map((lines) => (
          <Specimen key={lines} label={`CrewTextArea ${specimenLabel({ lines })}`}>
            <div className="w-96">
              <CrewTextArea
                aria-label="Goal"
                lines={lines}
                onChange={(event) => setGoal(event.target.value)}
                value={goal}
              />
            </div>
          </Specimen>
        ))}
        <Specimen label='CrewTextArea value=""'>
          <div className="w-96">
            <CrewTextArea aria-label="Goal" placeholder="What should the crew do?" value="" />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        files={1}
        name="LimitField"
        note="crew-limit: a figure as wide as it is typed, beside its unit"
        source="apps/web/src/components/zerops/crew/CrewRunDialog.tsx"
        uses={4}
      >
        <Specimen label={specimenLabel({ label: "Time", kind: "amount", suffix: "hours" })}>
          <div className="w-72">
            <LimitField
              kind="amount"
              label="Time"
              onChange={(_kind, text) => setHours(text)}
              suffix="hours"
              text={hours}
            />
          </div>
        </Specimen>
        <Specimen label={specimenLabel({ label: "Spend", kind: "unlimited", prefix: "$" })}>
          <div className="w-72">
            <LimitField kind="unlimited" label="Spend" onChange={noop} prefix="$" text="20" />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        files={1}
        name="Replying"
        note="menu-wait-reply: an answer typed in the menu's waiting row"
        source="apps/web/src/components/zerops/SidebarWaiting.tsx"
        uses={3}
      >
        {(
          [
            { replying: true, sending: false, error: undefined },
            { replying: true, sending: true, error: undefined },
            { replying: true, sending: false, error: "Fen did not get it. Try again." },
          ] as const
        ).map((state) => (
          <Specimen
            key={`${state.sending}-${state.error ?? ""}`}
            label={specimenLabel({
              replying: state.replying,
              sending: state.sending,
              error: state.error,
            })}
          >
            <div className="w-72">
              <Replying
                error={state.error}
                label="Answer Fen"
                onCancel={noop}
                onSend={noop}
                placeholder="Answer Fen"
                replying={state.replying}
                sending={state.sending}
              >
                <span className="text-sm">Which region should stage run in?</span>
              </Replying>
            </div>
          </Specimen>
        ))}
      </CensusLook>

      <CensusLook
        files={2}
        name="MateNameInput"
        note="the kit's InputGroup with its own die button"
        source="apps/web/src/components/zerops/MateNameInput.tsx"
        uses={2}
      >
        <Specimen label={specimenLabel({ invalid: false })}>
          <div className="w-72">
            <MateNameInput
              describedBy="kit-mate-name-note"
              id="kit-mate-name"
              invalid={false}
              onAnother={() => setName("Juno")}
              onValueChange={setName}
              value={name}
            />
          </div>
        </Specimen>
        <Specimen label={specimenLabel({ invalid: true })}>
          <div className="w-72">
            <MateNameInput
              describedBy="kit-mate-name-note"
              id="kit-mate-name-invalid"
              invalid
              onValueChange={noop}
              value=""
            />
          </div>
        </Specimen>
        <Specimen label={specimenLabel({ readOnly: true })}>
          <div className="w-72">
            <MateNameInput
              describedBy="kit-mate-name-note"
              id="kit-mate-name-read"
              invalid={false}
              onValueChange={noop}
              readOnly
              value="Fen"
            />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        files={1}
        name="VaultTextEditor"
        note="vault-textarea: .env text with a gutter"
        source="apps/web/src/components/zerops/vault/VaultEditors.tsx"
        uses={1}
      >
        <Specimen label="the fixture's Shared scope">
          <div className="w-[36rem]">
            <VaultTextEditor
              onCancel={noop}
              onChange={setVaultText}
              onReview={noop}
              scope={scope}
              text={vaultText}
            />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        files={1}
        name="ThemeJsonEditor"
        note="a textarea over highlighted JSON"
        source="apps/web/src/components/settings/ThemeImportDialog.tsx"
        uses={1}
      >
        <Specimen label="a theme's JSON">
          <div className="w-96 rounded-md border">
            <ThemeJsonEditor id="kit-theme-json" onChange={setJson} value={json} />
          </div>
        </Specimen>
      </CensusLook>

      <CensusLook
        files={1}
        name="MateRenameField"
        note="the menu row's name as a field; it takes focus as it opens"
        source="apps/web/src/components/zerops/SidebarMateMenu.tsx"
        uses={1}
      >
        <Specimen label='rename initialValue="Fen" (press to open)'>
          <RenameOpener />
        </Specimen>
      </CensusLook>
    </CensusLooks>
  );
}

export default defineKitSection({
  id: "home-made-fields",
  title: "Home-made fields",
  purpose: "Inputs, text areas and selects features drew for themselves instead of the kit's.",
  group: "Home-made",
  kind: "Fields",
  source: "apps/web/src/components",
  render: () => <FieldSpecimens />,
});
