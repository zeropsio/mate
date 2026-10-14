import { defineRule, type ESTree } from "@oxlint/plugins";
import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { resolveVariable } from "../utils.ts";

const RULE = "no-environment-as-project";
const ledger = loadExceptionLedger(RULE);
const childTable = "hq_(?:deploy_job|rollout)";
const sqlKeywords = new Set([
  "where",
  "join",
  "left",
  "right",
  "inner",
  "full",
  "on",
  "using",
  "set",
  "order",
  "group",
  "limit",
  "union",
  "returning",
]);
// Exact expansion synchronization statements are migration inputs, not business identity reads.
const synchronization = new Set(
  [
    "UPDATE hq_deploy_job SET environment_id = project_id WHERE project_id IS NOT NULL AND environment_id IS DISTINCT FROM project_id",
    "UPDATE hq_rollout r SET environment_id = CASE WHEN project_id IS NOT NULL THEN project_id ELSE environment_id END, left_out = ( SELECT coalesce(jsonb_agg(CASE WHEN entry->>'project_id' IS NOT NULL THEN entry || jsonb_build_object('environment_id', entry->'project_id') ELSE entry END ORDER BY ordinal), '[]'::jsonb) FROM jsonb_array_elements(r.left_out) WITH ORDINALITY AS entries(entry, ordinal) ) WHERE (project_id IS NOT NULL AND environment_id IS DISTINCT FROM project_id) OR EXISTS ( SELECT 1 FROM jsonb_array_elements(r.left_out) AS entries(entry) WHERE entry->>'project_id' IS NOT NULL AND entry->'environment_id' IS DISTINCT FROM entry->'project_id' )",
  ].map(normalizeFingerprint),
);

/** Syntax evidence only: brands protect typed sinks; this closes the explicit erasure blind spots. */
export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "An environment identity is not a project address outside its target binding.",
    },
  },
  create(context) {
    const path = /(?:^|\/)((?:apps|packages)\/[^/]+\/src\/.*\.[cm]?[jt]sx?)$/u.exec(
      context.filename.replaceAll("\\", "/"),
    )?.[1];
    if (path === undefined || /\.(?:test|spec)\.|\/__fixtures__\//u.test(path)) return {};
    const report = (node: ESTree.Node, kind: string, fingerprint: string) => {
      const key = { path, kind, fingerprint: normalizeFingerprint(fingerprint) };
      const ledgered = ledger.has(key);
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE,
          kind,
          fingerprint: key.fingerprint,
          ledgered,
          summary:
            "Resolve the environment and read its target.projectId before opening a project.",
        }),
      });
    };
    const propertyName = (node: ESTree.Node): string | undefined =>
      node.type === "Identifier"
        ? node.name
        : node.type === "Literal" && typeof node.value === "string"
          ? node.value
          : undefined;
    const importedName = (node: Extract<ESTree.Node, { type: "Identifier" }>): string => {
      const def = resolveVariable(context, node)?.defs[0]?.node;
      return def?.type === "ImportSpecifier"
        ? (propertyName(def.imported) ?? node.name)
        : node.name;
    };
    const annotationOf = (node: ESTree.Node): ESTree.TSType | undefined =>
      (node as ESTree.Node & { typeAnnotation?: ESTree.TSTypeAnnotation | null }).typeAnnotation
        ?.typeAnnotation;
    const brandedType = (type: ESTree.TSType | undefined, property?: string): boolean => {
      if (property !== undefined) {
        if (type?.type !== "TSTypeLiteral") return false;
        const field = type.members.find(
          (member) =>
            member.type === "TSPropertySignature" && propertyName(member.key) === property,
        );
        return (
          field?.type === "TSPropertySignature" && brandedType(field.typeAnnotation?.typeAnnotation)
        );
      }
      return (
        type?.type === "TSTypeReference" &&
        type.typeName.type === "Identifier" &&
        importedName(type.typeName) === "HqEnvironmentId"
      );
    };
    const isString = (node: ESTree.Node, seen = new Set<ESTree.Node>()): boolean => {
      if (seen.has(node) || node.type !== "Identifier") return false;
      seen.add(node);
      const variable = resolveVariable(context, node);
      if (node.name === "String" && (variable === undefined || variable.defs.length === 0))
        return true;
      const def = variable?.defs[0]?.node;
      return def?.type === "VariableDeclarator" && def.init !== null && isString(def.init, seen);
    };
    // The historic group route segment names an environment; Mate routes still name projects.
    const environmentRoute = (node: ESTree.Node, seen = new Set<ESTree.Node>()): boolean => {
      if (seen.has(node)) return false;
      seen.add(node);
      if (node.type === "Identifier") {
        const def = resolveVariable(context, node)?.defs[0]?.node;
        return (
          def?.type === "VariableDeclarator" &&
          def.init !== null &&
          environmentRoute(def.init, seen)
        );
      }
      if (node.type !== "CallExpression") return false;
      if (
        node.callee.type === "Identifier" &&
        importedName(node.callee) === "createFileRoute" &&
        node.arguments[0]?.type === "Literal"
      )
        return node.arguments[0].value === "/_chat/group/$groupId/$projectId";
      return environmentRoute(node.callee, seen);
    };
    const routeParams = (node: ESTree.Node, seen = new Set<ESTree.Node>()): boolean => {
      if (seen.has(node)) return false;
      seen.add(node);
      if (node.type === "CallExpression") return routeParams(node.callee, seen);
      if (node.type === "MemberExpression" && propertyName(node.property) === "useParams")
        return environmentRoute(node.object);
      if (node.type === "Identifier") {
        const def = resolveVariable(context, node)?.defs[0]?.node;
        return (
          def?.type === "VariableDeclarator" && def.init !== null && routeParams(def.init, seen)
        );
      }
      return false;
    };
    type Origin = "environment" | "route";
    const origin = (
      node: ESTree.Node,
      wanted: Origin,
      property?: string,
      seen = new Set<ESTree.Node>(),
    ): boolean => {
      if (seen.has(node)) return false;
      seen.add(node);
      if (node.type === "TSAsExpression" || node.type === "TSTypeAssertion") {
        return (
          (wanted === "environment" && brandedType(node.typeAnnotation, property)) ||
          origin(node.expression, wanted, property, seen)
        );
      }
      if (
        node.type === "TSNonNullExpression" ||
        node.type === "ParenthesizedExpression" ||
        node.type === "ChainExpression"
      )
        return origin(node.expression, wanted, property, seen);
      if (node.type === "CallExpression") {
        if (wanted === "route" && property === "projectId" && routeParams(node)) return true;
        if (
          wanted === "environment" &&
          property === undefined &&
          node.callee.type === "MemberExpression" &&
          propertyName(node.callee.property) === "make" &&
          node.callee.object.type === "Identifier" &&
          importedName(node.callee.object) === "HqEnvironmentId"
        )
          return true;
        if (
          (isString(node.callee) ||
            (node.callee.type === "MemberExpression" &&
              propertyName(node.callee.property) === "make")) &&
          node.arguments[0]
        )
          return origin(node.arguments[0], wanted, property, seen);
      }
      if (node.type === "MemberExpression")
        return origin(node.object, wanted, propertyName(node.property), seen);
      if (node.type === "ObjectExpression" && property !== undefined) {
        const field = node.properties.find(
          (field) => field.type === "Property" && propertyName(field.key) === property,
        );
        return field?.type === "Property" && origin(field.value, wanted, undefined, seen);
      }
      if (node.type !== "Identifier") return false;
      const variable = resolveVariable(context, node);
      for (const identifier of variable?.identifiers ?? []) {
        if (wanted === "environment" && brandedType(annotationOf(identifier), property))
          return true;
        // Destructured function parameters carry the annotation on the object pattern.
        const parent = identifier.parent;
        if (
          wanted === "environment" &&
          parent?.type === "Property" &&
          parent.parent.type === "ObjectPattern" &&
          brandedType(annotationOf(parent.parent), propertyName(parent.key))
        )
          return true;
      }
      const def = variable?.defs[0]?.node;
      if (def?.type !== "VariableDeclarator" || def.init === null) return false;
      if (def.id.type === "ObjectPattern") {
        const field = def.id.properties.find(
          (field) =>
            field.type === "Property" &&
            field.value.type === "Identifier" &&
            field.value.name === node.name,
        );
        if (field?.type === "Property")
          return origin(def.init, wanted, propertyName(field.key), seen);
      }
      return origin(def.init, wanted, property, seen);
    };
    const sqlText = (node: ESTree.Node, seen = new Set<ESTree.Node>()): string => {
      if (seen.has(node)) return "__value__";
      seen.add(node);
      if (node.type === "Literal" && typeof node.value === "string") return node.value;
      if (node.type === "TemplateLiteral")
        return node.quasis
          .map(
            (part, index) =>
              (part.value.cooked ?? part.value.raw) +
              (node.expressions[index] ? sqlText(node.expressions[index]!, new Set(seen)) : ""),
          )
          .join("");
      if (node.type === "Identifier") {
        const def = resolveVariable(context, node)?.defs[0]?.node;
        if (def?.type === "VariableDeclarator" && def.init) return sqlText(def.init, seen);
      }
      if (
        node.type === "CallExpression" &&
        node.callee.type === "MemberExpression" &&
        ["unsafe", "literal"].includes(propertyName(node.callee.property) ?? "") &&
        node.arguments[0]
      )
        return sqlText(node.arguments[0], seen);
      return "__value__";
    };
    const inspectSql = (node: ESTree.Node) => {
      const text = sqlText(node);
      if (
        !new RegExp(`\\b${childTable}\\b`, "iu").test(text) ||
        synchronization.has(normalizeFingerprint(text))
      )
        return;
      const aliases = new Set<string>();
      for (const match of text.matchAll(
        new RegExp(
          `\\b(?:from|join|update)\\s+(${childTable})(?:\\s+(?:as\\s+)?([a-z_][a-z_0-9]*))?`,
          "giu",
        ),
      )) {
        aliases.add(match[1]!.toLowerCase());
        if (match[2] && !sqlKeywords.has(match[2].toLowerCase()))
          aliases.add(match[2].toLowerCase());
      }
      // Strip only the paired compatibility column list; WHERE/RETURNING/joins remain reads.
      let reads = text.replace(
        new RegExp(`(\\binsert\\s+into\\s+${childTable}\\s*)\\(([^)]*)\\)`, "giu"),
        (whole: string, prefix: string, columns: string) =>
          /\benvironment_id\b/iu.test(columns) && /\bproject_id\b/iu.test(columns)
            ? `${prefix}(compatibility_columns)`
            : whole,
      );
      const qualified = [...reads.matchAll(/\b([a-z_][a-z_0-9]*)\s*\.\s*project_id\b/giu)].some(
        (match) => aliases.has(match[1]!.toLowerCase()),
      );
      const leftOut =
        /\bleft_out\b/iu.test(reads) &&
        (/->>?\s*'project_id'/iu.test(reads) ||
          /\bproject_id\s+text\b/iu.test(reads) ||
          /\bl\.project_id\b/iu.test(reads));
      reads = reads.replace(/\b[a-z_][a-z_0-9]*\s*\.\s*project_id\b/giu, "qualified_column");
      // Unqualified columns belong to their nearest SQL scope, not an unrelated nested query.
      // INSERT's paired columns were stripped; SELECT from an environment remains a binding.
      interface SqlScope {
        parent?: SqlScope;
        tables: Set<string>;
        childWrite: boolean;
        project: boolean;
      }
      const scopes: SqlScope[] = [{ tables: new Set(), childWrite: false, project: false }];
      let current = scopes[0]!;
      for (const token of reads.matchAll(
        /\(|\)|\b(from|join|update|into)\s+([a-z_][a-z_0-9]*)|\bproject_id\b/giu,
      )) {
        if (token[0] === "(") {
          current = { parent: current, tables: new Set(), childWrite: false, project: false };
          scopes.push(current);
        } else if (token[0] === ")") {
          current = current.parent ?? current;
        } else if (token[1] !== undefined) {
          const table = token[2]!.toLowerCase();
          if (token[1].toLowerCase() === "into")
            current.childWrite ||= /^(?:hq_deploy_job|hq_rollout)$/u.test(table);
          else current.tables.add(table);
        } else current.project = true;
      }
      const unqualified = scopes.some((scope) => {
        if (!scope.project) return false;
        let owner: SqlScope | undefined = scope;
        while (owner !== undefined && owner.tables.size === 0 && !owner.childWrite)
          owner = owner.parent;
        return (
          owner !== undefined &&
          ([...owner.tables].some((table) =>
            /^(?:hq_deploy_job|hq_rollout|left_out)$/u.test(table),
          ) ||
            (owner.childWrite && owner.tables.size === 0))
        );
      });
      if (qualified || leftOut || unqualified) report(node, "sql-project-identity-read", text);
    };
    const rawIn = (node: ESTree.Node): boolean => {
      if (node.type === "ArrayExpression")
        return node.elements.some((element) => element !== null && rawIn(element));
      return origin(node, "route");
    };
    const projectReads = new Set([
      "project",
      "getProject",
      "services",
      "builds",
      "useVisibleProjectAccess",
      "useDrawnProjectAccess",
      "useProjectFlows",
    ]);
    return {
      TemplateLiteral: inspectSql,
      Literal(node) {
        if (typeof node.value === "string") inspectSql(node);
      },
      TSAsExpression(node) {
        if (
          node.typeAnnotation.type === "TSStringKeyword" &&
          origin(node.expression, "environment")
        )
          report(node, "environment-id-erasure", context.sourceCode.getText(node));
      },
      CallExpression(node) {
        if (isString(node.callee) && node.arguments[0] && origin(node.arguments[0], "environment"))
          report(node, "environment-id-erasure", context.sourceCode.getText(node));
        const name =
          node.callee.type === "Identifier"
            ? importedName(node.callee)
            : node.callee.type === "MemberExpression"
              ? propertyName(node.callee.property)
              : undefined;
        const addressed = node.arguments.some(
          (argument) =>
            argument.type === "ObjectExpression" &&
            argument.properties.some(
              (field) =>
                field.type === "Property" &&
                propertyName(field.key) === "projectId" &&
                rawIn(field.value),
            ),
        );
        if (
          (name !== undefined && projectReads.has(name) && node.arguments.some(rawIn)) ||
          addressed
        )
          report(node, "raw-route-project-read", context.sourceCode.getText(node));
      },
      JSXAttribute(node) {
        if (
          node.name.type === "JSXIdentifier" &&
          node.name.name === "projectId" &&
          node.value?.type === "JSXExpressionContainer" &&
          origin(node.value.expression, "route")
        )
          report(node, "raw-route-project-read", context.sourceCode.getText(node));
      },
    };
  },
});
