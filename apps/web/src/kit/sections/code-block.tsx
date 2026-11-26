import { CodeBlock, CodeFrame } from "~/components/ui/code-block";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid, Specimens } from "../Specimen";

export const KIT_YAML = `zerops:
  - setup: api
    build:
      base: nodejs@22
      buildCommands:
        - pnpm install --frozen-lockfile
        - pnpm build
      deployFiles: ./dist
    run:
      base: nodejs@22
      ports:
        - port: 3000
          httpSupport: true
      start: node dist/server.js`;

export const KIT_ANSWER = `{
  "error": {
    "code": "userAlreadyInvited",
    "message": "An invitation for this address is already pending.",
    "meta": [{ "parameter": "email", "value": "ada@example.com" }]
  }
}`;

const OUTPUT = `$ pnpm build
vite v7.1.2 building for production...
✓ 1284 modules transformed.
dist/index.html                  0.62 kB │ gzip:  0.38 kB
dist/assets/index-a1b2c3d4.css  48.10 kB │ gzip:  9.84 kB
dist/assets/index-e5f6a7b8.js  412.77 kB │ gzip: 128.40 kB
✓ built in 6.42s`;

export default defineKitSection({
  id: "code-block",
  title: "CodeBlock",
  purpose:
    "A block of literal text standing on its own: code, a config, a command's output, an answer.",
  group: "Kit",
  kind: "Data",
  source: "apps/web/src/components/ui/code-block.tsx",
  render: () => (
    <Specimens>
      <SpecimenBlock note="The text whole, with Copy in its corner or its header." title="Forms">
        <SpecimenGrid size="lg">
          <Specimen align="start" label='copy="the answer"' note="A source's answer">
            <CodeBlock className="w-full" copy="the answer">
              {KIT_ANSWER}
            </CodeBlock>
          </Specimen>
          <Specimen
            align="start"
            label='title="zerops.yaml" copy wrap={false} height="md"'
            note="A config, its indent its meaning"
          >
            <CodeBlock
              className="w-full"
              copy="zerops.yaml"
              height="md"
              title="zerops.yaml"
              wrap={false}
            >
              {KIT_YAML}
            </CodeBlock>
          </Specimen>
          <Specimen align="start" label="children" note="A command's output, read whole">
            <CodeBlock className="w-full">{OUTPUT}</CodeBlock>
          </Specimen>
          <Specimen align="start" label='tone="error" copy' note="What a failed step answered">
            <CodeBlock className="w-full" copy="the answer" tone="error">
              {"Error: connect ECONNREFUSED 10.0.4.12:5432\n    at TCPConnectWrap.afterConnect"}
            </CodeBlock>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="Past its height the text scrolls inside, never the page."
        title="Heights"
      >
        <SpecimenGrid size="md">
          {(["sm", "md"] as const).map((height) => (
            <Specimen align="start" key={height} label={`height="${height}"`}>
              <CodeBlock className="w-full" height={height} wrap={false}>
                {`${KIT_YAML}\n${KIT_YAML}`}
              </CodeBlock>
            </Specimen>
          ))}
        </SpecimenGrid>
      </SpecimenBlock>
      <SpecimenBlock
        note="The frame alone, for text another renderer draws in it: a highlighter, a terminal."
        title="Frame"
      >
        <SpecimenGrid size="md">
          <Specimen align="start" label="<CodeFrame>" note="A terminal's lines on the code ground">
            <CodeFrame className="h-24 w-full">
              <span className="flex flex-col px-3 py-2 font-mono text-caption leading-5">
                <span>$ claude login</span>
                <span>Opening the sign-in page…</span>
              </span>
            </CodeFrame>
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </Specimens>
  ),
});
