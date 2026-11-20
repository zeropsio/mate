// @effect-diagnostics nodeBuiltinImport:off -- Oxlint reads sibling route files synchronously.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { defineRule } from "@oxlint/plugins";

const isRoute = (name: string) =>
  name.endsWith(".tsx") && !name.includes(".test.") && !name.startsWith("-");

export default defineRule({
  meta: {
    type: "problem",
    docs: { description: "Nested web routes need a parent that renders an Outlet." },
  },
  create(context) {
    const directory = NodePath.dirname(context.filename);
    const name = NodePath.basename(context.filename);
    if (!`/${directory.replaceAll("\\", "/")}`.endsWith("/apps/web/src/routes") || !isRoute(name)) {
      return {};
    }

    const stem = name.slice(0, -".tsx".length);
    const [parent] = stem.split(".");
    if (!parent || parent.endsWith("_")) return {};
    const parentFile = `${parent}.tsx`;

    return {
      Program(node) {
        const report = (child: string) =>
          context.report({
            node,
            message: `${child} nests under ${parentFile}, which renders no <Outlet />.`,
          });

        if (name !== parentFile) {
          const file = NodePath.join(directory, parentFile);
          if (
            NodeFS.statSync(file, { throwIfNoEntry: false })?.isFile() &&
            !NodeFS.readFileSync(file, "utf8").includes("<Outlet")
          )
            report(name);
          return;
        }

        if (context.sourceCode.text.includes("<Outlet")) return;
        for (const child of NodeFS.readdirSync(directory)) {
          if (child !== name && child.startsWith(`${parent}.`) && isRoute(child)) report(child);
        }
      },
    };
  },
});
