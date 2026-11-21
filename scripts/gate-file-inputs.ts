import { Visitor } from "oxc-parser";

// Repository-relative filesystem inputs join the import graph without traversing their imports.
// An empty declaration means the test reads only disposable files, not checkout inputs.
export const fileReadInputs: Readonly<Record<string, ReadonlyArray<string>>> = {
  "apps/server/src/attachments/attachments.unit.test.ts": [],
  "apps/server/src/auth/auth.unit.test.ts": [],
  "apps/server/src/provider/launch/launch.unit.test.ts": [],
  "apps/server/src/workspace/workspace.unit.test.ts": [],
  "apps/server/src/zerops/credentials/credentials.unit.test.ts": [],
  "apps/server/src/zerops/hqLink/hqLink.unit.test.ts": [],
  "scripts/hq-ref.ts": [".mate-hq-ref"],
};

// Inspect calls, not source text: comments and scripts held in strings are not filesystem reads.
export function hasFileReads(program: Parameters<Visitor["visit"]>[0]): boolean {
  let reads = false;
  const methods = new Set([
    "readFile",
    "readFileSync",
    "readFileString",
    "readDirectory",
    "readdir",
    "readdirSync",
    "createReadStream",
  ]);
  const aliases = new Set<string>();
  new Visitor({
    ImportDeclaration(node) {
      if (!["node:fs", "node:fs/promises", "fs", "fs/promises"].includes(node.source.value)) return;
      for (const specifier of node.specifiers) {
        if (
          specifier.type === "ImportSpecifier" &&
          methods.has(
            specifier.imported.type === "Identifier"
              ? specifier.imported.name
              : specifier.imported.value,
          )
        )
          aliases.add(specifier.local.name);
      }
    },
    CallExpression(node) {
      const callee = node.callee;
      if (callee.type === "Identifier" && (methods.has(callee.name) || aliases.has(callee.name)))
        reads = true;
      if (callee.type === "MemberExpression") {
        const property = callee.property;
        const name =
          property.type === "Identifier"
            ? property.name
            : property.type === "Literal"
              ? property.value
              : undefined;
        if (typeof name === "string" && methods.has(name)) reads = true;
      }
    },
  }).visit(program);
  return reads;
}
