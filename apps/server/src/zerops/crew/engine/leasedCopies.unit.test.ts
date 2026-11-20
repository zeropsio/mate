import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  CREW_OWNER_ID,
  CommandId,
  VcsProcessExitError,
  wakeId as deriveWakeId,
  type Principal,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import { TestClock } from "effect/testing";

import { layerTest as serverConfigTest } from "../../../config.ts";
import { sweepCheckpointRefs } from "../../../vcs/checkpointRefsSweep.ts";
import * as VcsProcess from "../../../vcs/VcsProcess.ts";
import * as ZeropsCommitAuthorModule from "../../ZeropsCommitAuthor.ts";
import {
  MOUNT_TABLE_PATH,
  MountTableReadError,
  REPOSITORY_CACHE_TTL,
  makeZeropsRepositorySource,
  parseMountTable,
  ZeropsRepositorySource,
  type ZeropsRepositories,
} from "../../ZeropsRepositorySource.ts";
import { crewDomain, crewRefusalOf } from "./CrewOwner.ts";

/** A VcsProcess that answers every git run with exit 0 and records it. */
const recordingVcs = (
  runs: Array<VcsProcess.VcsProcessInput>,
  refusing: ReadonlyArray<string> = [],
) =>
  Layer.succeed(
    VcsProcess.VcsProcess,
    VcsProcess.VcsProcess.of({
      run: (input) =>
        Effect.suspend(() => {
          runs.push(input);
          return refusing.includes(input.cwd)
            ? Effect.fail(
                new VcsProcessExitError({
                  operation: input.operation,
                  command: "git config",
                  cwd: input.cwd,
                  exitCode: 128,
                  detail: "fatal: not in a git directory",
                }),
              )
            : Effect.succeed({
                exitCode: 0 as VcsProcess.VcsProcessOutput["exitCode"],
                stdout: "",
                stderr: "",
                stdoutTruncated: false,
                stderrTruncated: false,
              });
        }),
    }),
  );

// The sweep: a source listing two services, a mount zcp's leases named and one only its name tells.
// witness: apps/server/src/vcs/checkpointRefsSweep.ts | ? listed.repositories.filter((repository) => !isLeaseRepository(repository)) → ? listed.repositories
it.effect(
  "CD63: A start sweeps the removed workspace capture's snapshot refs in each service checkout a Mate reaches, and never in a pool container a thread's agent leased, whether zcp's leases named it or only its name says so",
  () =>
    Effect.gen(function* () {
      const runs: Array<VcsProcess.VcsProcessInput> = [];
      const mounts: ReadonlyArray<{ mountPath: string; kind?: "lease" }> = [
        { mountPath: "/var/www/appdev" },
        { mountPath: "/var/www/apidev" },
        { mountPath: "/var/www/webpool", kind: "lease" },
        { mountPath: "/var/www/webpool-3" },
      ];
      const source = Layer.succeed(
        ZeropsRepositorySource,
        ZeropsRepositorySource.of({
          list: Effect.succeed({
            _tag: "available",
            repositories: mounts.map((mount) => ({
              ...mount,
              host: mount.mountPath.split("/").at(-1)!,
              remotePath: "/var/www",
            })),
          }),
          refresh: Effect.die("not read"),
          known: Effect.succeed([]),
          remember: () => Effect.void,
        }),
      );

      yield* sweepCheckpointRefs.pipe(
        Effect.provide(
          Layer.mergeAll(
            source,
            serverConfigTest("/nowhere", { prefix: "sweep" }),
            recordingVcs(runs),
          ),
        ),
      );

      expect([...new Set(runs.map((input) => input.cwd))].toSorted()).toEqual([
        "/var/www/apidev",
        "/var/www/appdev",
      ]);
    }).pipe(Effect.provide(NodeServices.layer)),
);

const AUTHOR = {
  name: "acme-mate[bot]",
  email: "4242+acme-mate[bot]@users.noreply.github.com",
};

const repository = (host: string) => ({
  host,
  mountPath: `/var/www/${host}`,
  remotePath: "/var/www",
});

const available = (...hosts: ReadonlyArray<string>): ZeropsRepositories => ({
  _tag: "available",
  repositories: hosts.map(repository),
});

/** The commit author over working copies as `listed`, git refusing in the working copies `refusing`. */
const rig = (listed: ZeropsRepositories, refusing: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const runs: Array<VcsProcess.VcsProcessInput> = [];
    const source = Layer.mock(ZeropsRepositorySource)({ list: Effect.succeed(listed) });
    const built = yield* Layer.build(
      ZeropsCommitAuthorModule.layer.pipe(
        Layer.provide(Layer.mergeAll(recordingVcs(runs, refusing), source)),
      ),
    );
    return { author: Context.get(built, ZeropsCommitAuthorModule.ZeropsCommitAuthor), runs };
  });

/** Each working copy's git config writes, as `cwd: args`. */
const writes = (runs: ReadonlyArray<VcsProcess.VcsProcessInput>) =>
  runs.map((input) => `${input.cwd}: ${input.args.join(" ")}`).toSorted();

// witness: apps/server/src/zerops/ZeropsCommitAuthor.ts | listed.repositories.filter((repository) => !isLeaseRepository(repository)), → listed.repositories,
it.effect(
  "CD64: A task's commit author becomes the git identity of every service working copy the Mate reaches, and never of a pool container a thread's agent leased",
  () =>
    Effect.gen(function* () {
      const services = yield* rig(available("appdev", "apidev"));
      yield* services.author.set(AUTHOR);
      expect(writes(services.runs)).toEqual([
        "/var/www/apidev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/apidev: config --local user.name acme-mate[bot]",
        "/var/www/appdev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/appdev: config --local user.name acme-mate[bot]",
      ]);
      expect(services.runs.every((input) => input.command === "git")).toBe(true);

      const leased = yield* rig({
        _tag: "available",
        repositories: [repository("appdev"), { ...repository("webpool-3"), kind: "lease" }],
      });
      yield* leased.author.set(AUTHOR);
      expect(writes(leased.runs)).toEqual([
        "/var/www/appdev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
        "/var/www/appdev: config --local user.name acme-mate[bot]",
      ]);
    }).pipe(Effect.scoped),
);

// witness: apps/server/src/zerops/ZeropsCommitAuthor.ts | return yield* new CommitAuthorUnset({ where: [] }); → return;
it.effect(
  "CD65: Setting the commit author names each working copy git refused while the others still get it, says the working copies are unset when they cannot be listed, never skipping them silently, and outside a Zerops container changes nothing",
  () =>
    Effect.gen(function* () {
      const refused = yield* rig(available("appdev", "apidev"), ["/var/www/apidev"]);
      const partly = yield* Effect.result(refused.author.set(AUTHOR));
      expect(Result.isFailure(partly) ? partly.failure._tag : "Success").toBe("CommitAuthorUnset");
      expect(Result.isFailure(partly) ? partly.failure.where : null).toEqual(["apidev"]);
      expect(writes(refused.runs)).toEqual(
        expect.arrayContaining([
          "/var/www/appdev: config --local user.email 4242+acme-mate[bot]@users.noreply.github.com",
          "/var/www/appdev: config --local user.name acme-mate[bot]",
        ]),
      );

      const unlisted = yield* rig({ _tag: "unavailable", reason: "mount table unreadable" });
      const unset = yield* Effect.result(unlisted.author.set(AUTHOR));
      expect(Result.isFailure(unset) ? unset.failure._tag : "Success").toBe("CommitAuthorUnset");
      expect(Result.isFailure(unset) ? unset.failure.where : null).toEqual([]);
      expect(unlisted.runs).toEqual([]);

      const off = yield* rig({ _tag: "disabled" });
      const untouched = yield* Effect.result(off.author.set(AUTHOR));
      expect(untouched._tag).toBe("Success");
      expect(off.runs).toEqual([]);
    }).pipe(Effect.scoped),
);

/**
 * `/proc/mounts` lines for `s3git1`, `s3git2` and `weatherdash`, measured on a Zerops dev
 * container 2026-09-04: one line per mounted dev service.
 */
const MEASURED_MOUNT_TABLE = [
  "s3git1:/var/www /var/www/s3git1 fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
  "s3git2:/var/www /var/www/s3git2 fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
  "weatherdash:/var/www /var/www/weatherdash fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
].join("\n");

/** zcp mounts a lease as it mounts a service: `<alias>:/var/www` at `/var/www/<alias>`. */
const LEASE_LINE =
  "webpool-3:/var/www /var/www/webpool-3 fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0";
const TABLE = [MEASURED_MOUNT_TABLE, LEASE_LINE].join("\n");

// A Zerops service hostname is lowercase alphanumeric only, so `<pool>-<number>` is a lease's.
// witness: apps/server/src/zerops/ZeropsRepositorySource.ts | const lease = isLeaseAliasName(repository.host) || aliases.has(repository.host); → const lease = aliases.has(repository.host);
it.effect(
  "CD66: A mount is a lease's when zcp's leases name it or its name has a lease alias's shape, pool-dash-number, which no service hostname can have; a service's name zcp's leases do not name stays a service's",
  () =>
    Effect.gen(function* () {
      const named = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable: Effect.succeed(TABLE),
        leaseAliases: Effect.succeed(new Set(["webpool-3"])),
      });
      const result = yield* named.refresh;
      expect(result._tag).toBe("available");
      const byHost = new Map(
        result._tag === "available"
          ? result.repositories.map((entry) => [entry.host, entry.kind])
          : [],
      );
      expect(byHost.get("webpool-3")).toBe("lease");
      expect(byHost.has("s3git1")).toBe(true);
      expect(byHost.get("s3git1")).toBeUndefined();

      for (const row of [
        { host: "webpool-3", aliases: [], kind: "lease" },
        { host: "webpool-3", aliases: ["webpool-3"], kind: "lease" },
        { host: "weatherdash", aliases: [], kind: undefined },
        { host: "weatherdash", aliases: ["weatherdash"], kind: "lease" },
      ]) {
        const source = yield* makeZeropsRepositorySource({
          enabled: true,
          readMountTable: Effect.succeed(TABLE),
          leaseAliases: Effect.succeed(new Set(row.aliases)),
        });
        const listed = yield* source.list;
        const kind =
          listed._tag === "available"
            ? listed.repositories.find((repository) => repository.host === row.host)?.kind
            : "unread";
        expect({ ...row, kind }).toStrictEqual(row);
      }
    }),
);

// witness: apps/server/src/zerops/ZeropsRepositorySource.ts | const { kind: _kind, identity: _identity, rootId: _rootId, ...rest } = repository; → const { kind: _kind, ...rest } = repository;
it.effect(
  "CD67: A mount verified before zcp's leases named it turns a lease's once they do, and is verified again under that kind: its earlier identity and root are not kept",
  () =>
    Effect.gen(function* () {
      const aliases = yield* Ref.make<ReadonlySet<string>>(new Set());
      const source = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable: Effect.succeed(TABLE),
        leaseAliases: Ref.get(aliases),
      });
      yield* source.refresh;
      // Verified while the leases had not named it yet (the mount lands before the result).
      yield* source.remember({
        host: "webpool-3",
        mountPath: "/var/www/webpool-3",
        remotePath: "/var/www",
        identity: { projectId: "p", serviceId: "pool" },
        rootId: "zerops:service-root",
      });
      yield* Ref.set(aliases, new Set(["webpool-3"]));
      expect((yield* source.known).find((entry) => entry.host === "webpool-3")).toStrictEqual({
        host: "webpool-3",
        mountPath: "/var/www/webpool-3",
        remotePath: "/var/www",
        kind: "lease",
      });
      const listed = yield* source.list;
      expect(
        listed._tag === "available"
          ? listed.repositories.find((entry) => entry.host === "webpool-3")?.kind
          : undefined,
      ).toBe("lease");
    }),
);

// witness: apps/server/src/zerops/ZeropsRepositorySource.ts | (source !== `${host}:/var/www` && source !== `zerops@${host}:/var/www`) → !source.endsWith(":/var/www")
it("CD68: A repository is a sshfs mount of a host's /var/www at /var/www/host; any other filesystem, a mount elsewhere, and a remote source that is not that host's /var/www are none", () => {
  for (const row of [
    {
      table: [
        "other:/var/www /var/www/app fuse.sshfs rw 0 0",
        "app:/somewhere /var/www/app fuse.sshfs rw 0 0",
        "app:/var/www /var/www/app fuse.sshfs rw 0 0",
      ].join("\n"),
      repositories: [{ host: "app", mountPath: "/var/www/app" }],
    },
    {
      table: MEASURED_MOUNT_TABLE,
      repositories: [
        { host: "s3git1", mountPath: "/var/www/s3git1" },
        { host: "s3git2", mountPath: "/var/www/s3git2" },
        { host: "weatherdash", mountPath: "/var/www/weatherdash" },
      ],
    },
    {
      table: [
        "overlay / overlay rw,relatime,lowerdir=/,upperdir=/upper 0 0",
        "proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0",
        "tmpfs /var/www/scratch tmpfs rw,relatime 0 0",
        "otherhost:/var/www /mnt/otherhost fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
        "kanbandev:/var/www /var/www/kanbandev fuse.sshfs rw,nosuid,nodev,relatime,user_id=2023,group_id=2023 0 0",
      ].join("\n"),
      repositories: [{ host: "kanbandev", mountPath: "/var/www/kanbandev" }],
    },
    {
      table: LEASE_LINE,
      repositories: [{ host: "webpool-3", mountPath: "/var/www/webpool-3" }],
    },
  ]) {
    expect(parseMountTable(row.table)).toEqual(row.repositories);
  }
});

// witness: apps/server/src/zerops/ZeropsRepositorySource.ts | Effect.succeed<ZeropsRepositories>({ _tag: "unavailable", reason: error.message }), → Effect.succeed<ZeropsRepositories>({ _tag: "available", repositories: [] }),
it.effect(
  "CD69: An unreadable mount table lists the repositories as unavailable, naming the table, never as none; off Zerops the source is disabled and never reads it",
  () =>
    Effect.gen(function* () {
      const unreadable = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable: Effect.fail(
          new MountTableReadError({ path: MOUNT_TABLE_PATH, cause: "EACCES" }),
        ),
      });
      const result = yield* unreadable.list;
      expect(result._tag).toBe("unavailable");
      expect(result._tag === "unavailable" && result.reason.includes(MOUNT_TABLE_PATH)).toBe(true);

      const reads = yield* Ref.make(0);
      const off = yield* makeZeropsRepositorySource({
        enabled: false,
        readMountTable: Ref.update(reads, (n) => n + 1).pipe(Effect.andThen(Effect.succeed(""))),
      });
      expect((yield* off.list)._tag).toBe("disabled");
      expect(yield* Ref.get(reads)).toBe(0);
    }),
);

// witness: apps/server/src/zerops/ZeropsRepositorySource.ts | ...previous.filter((entry) => entry.mountPath !== repository.mountPath), → ...previous,
it.effect(
  "CD70: A repository verified once stays known with its identity after its mount goes, though the listing no longer shows it attached",
  () =>
    Effect.gen(function* () {
      const table = yield* Ref.make(MEASURED_MOUNT_TABLE);
      const source = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable: Ref.get(table),
      });
      yield* source.refresh;
      const verified = {
        host: "s3git1",
        mountPath: "/var/www/s3git1",
        remotePath: "/var/www",
        identity: { projectId: "p", serviceId: "s" },
      };
      yield* source.remember(verified);
      yield* Ref.set(table, "");
      expect(yield* source.refresh).toStrictEqual({ _tag: "available", repositories: [] });
      expect((yield* source.known).find((entry) => entry.host === "s3git1")).toStrictEqual(
        verified,
      );
    }),
);

// witness: apps/server/src/zerops/ZeropsRepositorySource.ts | if (now - cached.readAt < Duration.toMillis(REPOSITORY_CACHE_TTL)) { → if (now - cached.readAt <= Duration.toMillis(REPOSITORY_CACHE_TTL)) {
it.effect(
  "CD71: The repository listing is read again once 30 seconds have passed, not before, and at every turn start whatever its age",
  () =>
    Effect.gen(function* () {
      const reads = yield* Ref.make(0);
      const source = yield* makeZeropsRepositorySource({
        enabled: true,
        readMountTable: Ref.updateAndGet(reads, (n) => n + 1).pipe(
          Effect.map(() => MEASURED_MOUNT_TABLE),
        ),
      });

      yield* source.list;
      yield* TestClock.adjust(Duration.millis(Duration.toMillis(REPOSITORY_CACHE_TTL) - 1));
      yield* source.list;
      expect(yield* Ref.get(reads)).toBe(1);

      yield* TestClock.adjust(Duration.millis(1));
      yield* source.list;
      expect(yield* Ref.get(reads)).toBe(2);

      yield* source.refresh;
      expect(yield* Ref.get(reads)).toBe(3);
    }),
);

const KAREL: Principal = { kind: "person", subject: "zerops:karel" };

// witness: apps/server/src/zerops/crew/engine/CrewOwner.ts | if (wake === undefined) return refusedAs("wake-not-armed"); → if (wake === undefined && armedSeq !== undefined) return refusedAs("wake-not-armed");
it("CD72: A wake the crew no longer holds is refused as not armed, so the scheduler drops it", () => {
  const decision = crewDomain.decide(
    crewDomain.initial(CREW_OWNER_ID),
    {
      commandId: CommandId.make("wake-1"),
      conversationId: CREW_OWNER_ID,
      principal: { kind: "engine" },
      command: { _tag: "WakeFired", wakeId: deriveWakeId(CREW_OWNER_ID, "question", "t1") },
    },
    0,
  );
  expect(decision._tag).toBe("Reject");
  expect(decision._tag === "Reject" ? decision.rejection.reason : null).toBe("wake-not-armed");
});

// witness: apps/server/src/zerops/crew/engine/CrewOwner.ts | detail: JSON.stringify({ crew: reason, detail }), → detail: detail ?? reason,
it("CD73: A press the crew refuses comes back from the engine with the crew's own reason", () => {
  const decision = crewDomain.decide(
    crewDomain.initial(CREW_OWNER_ID),
    {
      commandId: CommandId.make("press-1"),
      conversationId: CREW_OWNER_ID,
      principal: KAREL,
      command: {
        _tag: "Press",
        press: { _tag: "message", handle: "backend", text: "hi", attachments: [] },
        door: { refusal: null },
      },
    },
    0,
  );
  expect(decision._tag).toBe("Reject");
  expect(decision._tag === "Reject" ? crewRefusalOf(decision.rejection).reason : null).toBe(
    "no-crew",
  );
});
