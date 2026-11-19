import { ThreadId, type SpiToolCall, type ZeropsLease } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";

import {
  checkedRead,
  leaseChangesFor,
  leaseFactsOf,
  renewedLeases,
  type LeaseBinding,
} from "./leaseBinding.ts";

const changes = (
  call: SpiToolCall,
  text: string,
  read: ReadonlyArray<ZeropsLease> | undefined,
  bindings: ReadonlyArray<LeaseBinding>,
  owner: ThreadId,
  renewed: ReadonlyArray<string> = [],
) => leaseChangesFor(leaseFactsOf(call, text, read, true, renewed, undefined, owner), bindings);

const ada = ThreadId.make("ada");
const bob = ThreadId.make("bob");
const cid = ThreadId.make("cid");
const mate = ThreadId.make("mate");

const leaseTool = { name: "zerops_lease", rawName: "mcp__zerops__zerops_lease" };
const acquireWeb = {
  ...leaseTool,
  arguments: { action: "acquire", pool: "webpool", branch: "feat-x" },
};
const acquireGroup = {
  ...leaseTool,
  arguments: { action: "acquire", pools: ["hqpool", "webpool"], branch: "feat-x" },
};
const releaseWeb = { ...leaseTool, arguments: { action: "release", lease: "webpool-3" } };
const status = {
  name: "zerops_deploy",
  rawName: "mcp__zerops__zerops_deploy",
  arguments: { action: "status" },
};
const deployed = JSON.stringify({ status: "DEPLOYED" });

const web3: ZeropsLease = {
  alias: "webpool-3",
  pool: "webpool",
  branch: "feat-x",
  containerHostname: "node-id-3.runtime.webpool.zerops",
  state: "held",
  unverified: false,
};
const web4: ZeropsLease = {
  ...web3,
  alias: "webpool-4",
  containerHostname: "node-id-4.runtime.webpool.zerops",
};
const hq2: ZeropsLease = {
  alias: "hqpool-2",
  pool: "hqpool",
  branch: "feat-x",
  containerHostname: "node-id-2.runtime.hqpool.zerops",
  state: "held",
  unverified: false,
};
const api4: ZeropsLease = {
  alias: "apipool-4",
  pool: "apipool",
  branch: "feat-x",
  containerHostname: "node-id-4.runtime.apipool.zerops",
  state: "held",
  unverified: false,
};
const adaOnWeb: LeaseBinding = {
  conversation: ada,
  alias: "webpool-3",
  branch: "feat-x",
  repo: undefined,
  acquiredAt: undefined,
};

const WEB = "https://hq.example.zerops.app/git/acme/web";
const API = "https://hq.example.zerops.app/git/acme/api";
const adasWeb: ZeropsLease = {
  alias: "webpool-2",
  pool: "webpool",
  branch: "main",
  containerHostname: "node-id-2.runtime.webpool.zerops",
  state: "held",
  unverified: false,
  repo: WEB,
  acquiredAt: "2026-10-23T12:00:03Z",
};
const twoApps: ReadonlyArray<ZeropsLease> = [
  adasWeb,
  {
    alias: "apipool-1",
    pool: "apipool",
    branch: "main",
    containerHostname: "node-id-1.runtime.apipool.zerops",
    state: "held",
    unverified: false,
    repo: API,
    acquiredAt: "2026-10-23T12:00:00Z",
  },
  {
    alias: "docspool-4",
    pool: "docspool",
    branch: "main",
    containerHostname: "node-id-4.runtime.docspool.zerops",
    state: "held",
    unverified: false,
    repo: WEB,
    acquiredAt: "2026-10-23T12:00:02Z",
  },
  {
    alias: "hqpool-5",
    pool: "hqpool",
    branch: "main",
    containerHostname: "node-id-5.runtime.hqpool.zerops",
    state: "held",
    unverified: false,
    repo: WEB,
    acquiredAt: "2026-10-23T12:00:04Z",
  },
];

const adaOnHq: LeaseBinding = {
  conversation: ada,
  alias: "hqpool-2",
  branch: "feat-x",
  repo: undefined,
  acquiredAt: "2026-10-23T12:00:03Z",
};
const otherGroupLeases: ReadonlyArray<ZeropsLease> = [
  { ...web3, acquiredAt: "2026-10-23T12:00:02Z" },
  { ...api4, acquiredAt: "2026-10-23T12:00:01Z" },
  {
    alias: "docspool-5",
    pool: "docspool",
    branch: "feat-x",
    containerHostname: "node-id-5.runtime.docspool.zerops",
    state: "lost",
    unverified: false,
    acquiredAt: "2026-10-23T12:00:00Z",
  },
  {
    ...hq2,
    alias: "hqpool-6",
    branch: "feat-y",
    containerHostname: "node-id-6.runtime.hqpool.zerops",
    acquiredAt: "2026-10-23T11:00:00Z",
  },
];

const first: ZeropsLease = { ...web3, acquiredAt: "2026-10-23T12:00:00Z" };
const again: ZeropsLease = { ...web3, acquiredAt: "2026-10-23T14:00:00Z" };

// witness: apps/server/src/zerops/lease/leaseBinding.ts | ? null : lease.branch → ? "main" : lease.branch
it("LB1: An acquire binds its conversation to the lease it leased by that lease's alias, pool, branch, repository and the time zcp acquired it; a lease acquired for no branch is bound with none", () => {
  const branchless: ZeropsLease = {
    alias: "webpool-3",
    pool: "webpool",
    containerHostname: "node-id-3.runtime.webpool.zerops",
    state: "held",
    unverified: false,
  };
  expect(
    changes(acquireWeb, JSON.stringify({ action: "acquire", leases: [adasWeb] }), twoApps, [], ada),
  ).toEqual([
    {
      conversation: ada,
      change: {
        _tag: "BindLease",
        lease: {
          alias: "webpool-2",
          pool: "webpool",
          branch: "main",
          repo: WEB,
          acquiredAt: "2026-10-23T12:00:03Z",
        },
      },
    },
  ]);
  expect(
    changes(
      { ...leaseTool, arguments: { action: "acquire", pool: "webpool" } },
      JSON.stringify({ action: "acquire", leases: [branchless] }),
      undefined,
      [],
      mate,
    ),
  ).toEqual([
    {
      conversation: mate,
      change: { _tag: "BindLease", lease: { alias: "webpool-3", pool: "webpool", branch: null } },
    },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | const [first] = leased; → const first = leased.at(-1);
it("LB2: A group acquire binds its conversation to the first lease its result lists that zcp did not already hold", () => {
  const read = [hq2, web3];
  expect(
    changes(
      acquireGroup,
      JSON.stringify({ action: "acquire", leases: [hq2, web3] }),
      read,
      [],
      ada,
    ),
  ).toEqual([
    {
      conversation: ada,
      change: { _tag: "BindLease", lease: { alias: "hqpool-2", pool: "hqpool", branch: "feat-x" } },
    },
  ]);
  expect(
    changes(
      acquireGroup,
      JSON.stringify({ action: "acquire", leases: [{ ...hq2, reused: true }, web3] }),
      read,
      [
        {
          conversation: ada,
          alias: "hqpool-2",
          branch: "feat-x",
          repo: undefined,
          acquiredAt: undefined,
        },
      ],
      bob,
    ),
  ).toEqual([
    {
      conversation: bob,
      change: {
        _tag: "BindLease",
        lease: { alias: "webpool-3", pool: "webpool", branch: "feat-x" },
      },
    },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | (branch === undefined || lease.branch === branch) → (branch === undefined || lease.branch !== branch)
it("LB3: An acquire whose result lists no lease of its own binds the one lease of its pool and branch that zcp's leases hold", () => {
  expect(
    changes(
      { ...leaseTool, arguments: { action: "acquire", pool: "webpool", branch: "feat-y" } },
      JSON.stringify({ action: "acquire", leases: [] }),
      [web3, { ...web4, branch: "feat-y" }],
      [],
      mate,
    ),
  ).toEqual([
    {
      conversation: mate,
      change: {
        _tag: "BindLease",
        lease: { alias: "webpool-4", pool: "webpool", branch: "feat-y" },
      },
    },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | own.length > 0 → own.some((lease) => lease.reused !== true)
it("LB4: An acquire that comes back with only leases zcp already held binds nothing and unbinds nothing", () => {
  const read = [web3, hq2];
  expect(
    changes(
      acquireWeb,
      JSON.stringify({ action: "acquire", leases: [{ ...web3, reused: true }] }),
      read,
      [adaOnWeb],
      bob,
    ),
  ).toEqual([]);
  expect(
    changes(
      {
        ...leaseTool,
        arguments: { action: "acquire", pools: ["webpool", "hqpool"], branch: "feat-x" },
      },
      JSON.stringify({
        action: "acquire",
        leases: [
          { ...web3, reused: true },
          { ...hq2, reused: true },
        ],
      }),
      read,
      [adaOnWeb],
      bob,
    ),
  ).toEqual([]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | .filter((lease) => !isZeropsLeaseHeld(lease.state)) → .filter((lease) => isZeropsLeaseHeld(lease.state))
it("LB5: A release unbinds every conversation bound to the lease it names and to each lease its result says it released, whichever conversation released it", () => {
  const released = JSON.stringify({ action: "release", leases: [{ ...web3, state: "released" }] });
  expect(changes(releaseWeb, released, undefined, [adaOnWeb], ada)).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-3" } },
  ]);
  expect(changes(releaseWeb, released, [], [adaOnWeb], bob)).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-3" } },
  ]);
  expect(
    changes(
      { ...leaseTool, arguments: { action: "release", branch: "feat-x" } },
      JSON.stringify({
        action: "release",
        leases: [
          { ...hq2, state: "released" },
          { ...web3, state: "released" },
        ],
      }),
      undefined,
      [
        {
          conversation: ada,
          alias: "hqpool-2",
          branch: "feat-x",
          repo: undefined,
          acquiredAt: undefined,
        },
        {
          conversation: bob,
          alias: "webpool-3",
          branch: "feat-x",
          repo: undefined,
          acquiredAt: undefined,
        },
      ],
      cid,
    ),
  ).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "hqpool-2" } },
    { conversation: bob, change: { _tag: "UnbindLease", ended: "webpool-3" } },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | read.filter((lease) => isZeropsLeaseHeld(lease.state)).map → read.map
it("LB6: A read of zcp's leases that no longer names a bound lease, or names it lost, released or reserved with no record of zcp's, unbinds every conversation bound to it and no other, whichever conversation read it", () => {
  const bobsOwn: ZeropsLease = { ...web4, branch: "feat-y" };
  const bindings = [
    adaOnWeb,
    {
      conversation: bob,
      alias: "webpool-4",
      branch: "feat-y",
      repo: undefined,
      acquiredAt: undefined,
    },
  ];
  for (const read of [
    [bobsOwn],
    [{ ...web3, state: "lost" }, bobsOwn],
    [{ ...web3, state: "released" }, bobsOwn],
    [{ ...web3, state: "unknown-holder" }, bobsOwn],
  ]) {
    expect(changes(status, deployed, read, bindings, cid)).toEqual([
      { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-3" } },
    ]);
  }
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | acquired.aliases.includes(alias) → acquired.lease.alias === alias
it("LB7: A lease another conversation acquires unbinds the conversation bound to it, and only the acquirer is bound to it", () => {
  expect(
    changes(
      acquireWeb,
      JSON.stringify({ action: "acquire", leases: [web3] }),
      [web3],
      [adaOnWeb],
      cid,
    ),
  ).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-3" } },
    {
      conversation: cid,
      change: {
        _tag: "BindLease",
        lease: { alias: "webpool-3", pool: "webpool", branch: "feat-x" },
      },
    },
  ]);
  expect(
    changes(
      {
        ...leaseTool,
        arguments: { action: "acquire", pools: ["hqpool", "webpool", "apipool"], branch: "feat-x" },
      },
      JSON.stringify({ action: "acquire", leases: [hq2, web3, { ...api4, reused: true }] }),
      [hq2, web3, api4],
      [
        {
          conversation: cid,
          alias: "webpool-3",
          branch: "feat-y",
          repo: undefined,
          acquiredAt: undefined,
        },
      ],
      ada,
    ),
  ).toEqual([
    { conversation: cid, change: { _tag: "UnbindLease", ended: "webpool-3" } },
    {
      conversation: ada,
      change: { _tag: "BindLease", lease: { alias: "hqpool-2", pool: "hqpool", branch: "feat-x" } },
    },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | binding.conversation === acquired.by → binding.alias === acquired.lease.alias
it("LB8: A conversation whose lease ended in the call that acquires its next one is unbound first and then bound to the lease it acquired", () => {
  expect(
    changes(
      acquireWeb,
      JSON.stringify({ action: "acquire", leases: [web4] }),
      [{ ...web3, state: "lost" }, web4],
      [adaOnWeb],
      ada,
    ),
  ).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-3" } },
    {
      conversation: ada,
      change: {
        _tag: "BindLease",
        lease: { alias: "webpool-4", pool: "webpool", branch: "feat-x" },
      },
    },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | acquiredAtMs(lease) < acquiredAtMs(best) → acquiredAtMs(lease) > acquiredAtMs(best)
it("LB9: When a conversation's lease ends, the conversation is bound to the earliest-acquired lease of its repository and branch still held, never another app's lease of the same branch, a lease of another branch or one no longer held; with none it stays unbound", () => {
  const releaseHq = { ...leaseTool, arguments: { action: "release", lease: "hqpool-2" } };
  // The named release's result carries a webpool lease even when its alias is hqpool-2.
  const releasedHq: ZeropsLease = {
    ...web3,
    alias: "hqpool-2",
    containerHostname: "node-id-2.runtime.webpool.zerops",
    state: "released",
  };
  const released = JSON.stringify({ action: "release", leases: [releasedHq] });
  const next = [
    { conversation: ada, change: { _tag: "UnbindLease", ended: "hqpool-2" } },
    {
      conversation: ada,
      change: {
        _tag: "BindLease",
        lease: {
          alias: "apipool-4",
          pool: "apipool",
          branch: "feat-x",
          acquiredAt: "2026-10-23T12:00:01Z",
        },
      },
    },
  ];
  expect(changes(releaseHq, released, otherGroupLeases, [adaOnHq], ada)).toEqual(next);
  expect(
    changes(status, deployed, [{ ...hq2, state: "lost" }, ...otherGroupLeases], [adaOnHq], cid),
  ).toEqual(next);
  expect(changes(status, deployed, otherGroupLeases, [adaOnHq], cid)).toEqual(next);
  expect(
    changes(
      { ...leaseTool, arguments: { action: "release", lease: "webpool-2" } },
      JSON.stringify({ action: "release", leases: [{ ...releasedHq, alias: "webpool-2" }] }),
      twoApps.slice(1),
      [
        {
          conversation: ada,
          alias: "webpool-2",
          branch: "main",
          repo: WEB,
          acquiredAt: "2026-10-23T12:00:03Z",
        },
      ],
      ada,
    ),
  ).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-2" } },
    {
      conversation: ada,
      change: {
        _tag: "BindLease",
        lease: {
          alias: "docspool-4",
          pool: "docspool",
          branch: "main",
          repo: WEB,
          acquiredAt: "2026-10-23T12:00:02Z",
        },
      },
    },
  ]);
  expect(
    changes(
      releaseHq,
      released,
      otherGroupLeases.filter(({ state, branch }) => state !== "held" || branch !== "feat-x"),
      [adaOnHq],
      ada,
    ),
  ).toEqual([{ conversation: ada, change: { _tag: "UnbindLease", ended: "hqpool-2" } }]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | !acquiredByAnother(lease.alias, binding.conversation) → lease.alias !== acquired?.lease.alias
it("LB10: A conversation whose lease another conversation acquired again is bound next to the earliest-acquired lease of its branch still held that the other did not lease in that call", () => {
  const bobs: ReadonlyArray<ZeropsLease> = [
    { ...hq2, acquiredAt: "2026-10-23T13:00:00Z" },
    { ...api4, acquiredAt: "2026-10-23T13:00:00Z" },
  ];
  const call = {
    ...leaseTool,
    arguments: { action: "acquire", pools: ["hqpool", "apipool"], branch: "feat-x" },
  };
  const result = JSON.stringify({ action: "acquire", leases: bobs });
  const read = [...bobs, ...otherGroupLeases.filter(({ alias }) => alias !== "apipool-4")];
  expect(changes(call, result, read, [adaOnHq], bob)).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "hqpool-2" } },
    {
      conversation: ada,
      change: {
        _tag: "BindLease",
        lease: {
          alias: "webpool-3",
          pool: "webpool",
          branch: "feat-x",
          acquiredAt: "2026-10-23T12:00:02Z",
        },
      },
    },
    {
      conversation: bob,
      change: {
        _tag: "BindLease",
        lease: {
          alias: "hqpool-2",
          pool: "hqpool",
          branch: "feat-x",
          acquiredAt: "2026-10-23T13:00:00Z",
        },
      },
    },
  ]);
  expect(changes(call, result, bobs, [adaOnHq], bob)).toEqual([
    { conversation: ada, change: { _tag: "UnbindLease", ended: "hqpool-2" } },
    {
      conversation: bob,
      change: {
        _tag: "BindLease",
        lease: {
          alias: "hqpool-2",
          pool: "hqpool",
          branch: "feat-x",
          acquiredAt: "2026-10-23T13:00:00Z",
        },
      },
    },
  ]);
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | now.acquiredAt !== acquiredAt → now.acquiredAt === acquiredAt
it("LB11: A lease handed out again under the same alias while no call read it unbinds the conversation bound to the lease before, whether the new lease is of the same branch or another", () => {
  const bindings = [{ ...adaOnWeb, acquiredAt: "2026-10-23T12:00:00Z" }];
  for (const branch of ["feat-y", "feat-x"]) {
    const read = [{ ...again, branch }];
    const renewed = renewedLeases(read, checkedRead([first], undefined));
    expect(changes(status, deployed, read, bindings, cid, renewed)).toEqual([
      { conversation: ada, change: { _tag: "UnbindLease", ended: "webpool-3" } },
    ]);
  }
});

// witness: apps/server/src/zerops/lease/leaseBinding.ts | if (acquiredAt === undefined) return facts.renewed.includes(alias); → if (acquiredAt === undefined || facts.renewed.length > 0) return facts.renewed.includes(alias);
it("LB12: The conversation that acquired an alias handed out again stays bound at a later read of that lease, even while the last checked read still names the lease before", () => {
  const read = [again];
  const renewed = renewedLeases(read, checkedRead([first], undefined));
  expect(renewed).toEqual(["webpool-3"]);
  expect(
    changes(
      status,
      deployed,
      read,
      [
        {
          conversation: bob,
          alias: "webpool-3",
          branch: "feat-x",
          repo: undefined,
          acquiredAt: "2026-10-23T14:00:00Z",
        },
      ],
      cid,
      renewed,
    ),
  ).toEqual([]);
});
