import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldItem, FieldLabel } from "~/components/ui/field";
import { Fieldset, FieldsetLegend } from "~/components/ui/fieldset";
import { Form } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

function FieldSpecimens() {
  return (
    <Specimens>
      <SpecimenBlock note="A control's name, its help and its error." title="Fields">
        <SpecimenGrid size="md">
          <Specimen label="<Label>" note="A label beside its control">
            <Label>
              <Checkbox defaultChecked />
              Deploy on push
            </Label>
          </Specimen>
          <Specimen label="<Field> · <FieldLabel> · <FieldDescription>" note="A name and its help">
            <div className="w-full max-w-64">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input defaultValue="storefront" />
                <FieldDescription>Lowercase letters and numbers.</FieldDescription>
              </Field>
            </div>
          </Specimen>
          <Specimen label="<Field invalid> · <FieldError match>" note="A value that cannot be used">
            <div className="w-full max-w-64">
              <Field invalid>
                <FieldLabel>Name</FieldLabel>
                <Input defaultValue="Store Front" />
                <FieldError match>Use lowercase letters and numbers only.</FieldError>
              </Field>
            </div>
          </Specimen>
          <Specimen label="<Field disabled>">
            <div className="w-full max-w-64">
              <Field disabled>
                <FieldLabel>Name</FieldLabel>
                <Input defaultValue="storefront" />
              </Field>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock note="Fields grouped under a legend, in a form with its press." title="Forms">
        <SpecimenGrid size="md">
          <Specimen
            label="<Form> · <Fieldset> · <FieldsetLegend> · <FieldItem>"
            note="A new project's form"
          >
            <div className="w-full max-w-72">
              <Form onSubmit={(event) => event.preventDefault()}>
                <Fieldset>
                  <FieldsetLegend>New project</FieldsetLegend>
                  <Field>
                    <FieldLabel>Name</FieldLabel>
                    <Input placeholder="storefront" />
                  </Field>
                  <Field>
                    <FieldItem>
                      <Label>
                        <Checkbox />
                        Start from a template
                      </Label>
                    </FieldItem>
                  </Field>
                </Fieldset>
                <Button type="submit">Create</Button>
              </Form>
            </div>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  );
}

export default defineKitSection({
  id: "field",
  title: "Field, Fieldset, Label, Form",
  purpose: "A control's name, help and error, and the groups and forms around them.",
  group: "Kit",
  kind: "Fields",
  source: "apps/web/src/components/ui/field.tsx",
  render: () => <FieldSpecimens />,
});
