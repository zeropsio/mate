import * as Schema from "effect/Schema";

export class ServerCliCommandExitError extends Schema.TaggedErrorClass<ServerCliCommandExitError>()(
  "ServerCliCommandExitError",
  {
    command: Schema.String,
    args: Schema.Array(Schema.String),
    cwd: Schema.optional(Schema.String),
    exitCode: Schema.Int,
  },
) {
  override get message(): string {
    return `Command exited with non-zero exit code (${this.exitCode})`;
  }
}

export class ServerCliBuildAssetMissingError extends Schema.TaggedErrorClass<ServerCliBuildAssetMissingError>()(
  "ServerCliBuildAssetMissingError",
  {
    assetPath: Schema.String,
  },
) {
  override get message(): string {
    return `Missing build asset: ${this.assetPath}. Run the build subcommand first.`;
  }
}

/**
 * The emitted bundle statically imports a package the release manifest does not
 * declare. Raised at pack time because the alternative is a published tarball
 * whose entry point throws ERR_MODULE_NOT_FOUND inside `zerops@z3` on a
 * container — the manifest declares only what the bundler left external, so a
 * package that stops being inlined has to be noticed here.
 */
export class ServerCliUndeclaredRuntimeImportError extends Schema.TaggedErrorClass<ServerCliUndeclaredRuntimeImportError>()(
  "ServerCliUndeclaredRuntimeImportError",
  {
    packages: Schema.Array(Schema.String),
    bundleDir: Schema.String,
  },
) {
  override get message(): string {
    return `The bundle in ${this.bundleDir} statically imports ${this.packages.join(", ")}, which the release manifest does not declare. Either it belongs in CLI_RUNTIME_EXTERNAL_PREFIXES (scripts/lib/cli-external-packages.ts), or the bundler stopped inlining it.`;
  }
}
