next: LB13

- LB1 — An acquire binds its conversation to the lease it leased by that lease's alias, pool, branch, repository and the time zcp acquired it; a lease acquired for no branch is bound with none
- LB2 — A group acquire binds its conversation to the first lease its result lists that zcp did not already hold
- LB3 — An acquire whose result lists no lease of its own binds the one lease of its pool and branch that zcp's leases hold
- LB4 — An acquire that comes back with only leases zcp already held binds nothing and unbinds nothing
- LB5 — A release unbinds every conversation bound to the lease it names and to each lease its result says it released, whichever conversation released it
- LB6 — A read of zcp's leases that no longer names a bound lease, or names it lost, released or reserved with no record of zcp's, unbinds every conversation bound to it and no other, whichever conversation read it
- LB7 — A lease another conversation acquires unbinds the conversation bound to it, and only the acquirer is bound to it
- LB8 — A conversation whose lease ended in the call that acquires its next one is unbound first and then bound to the lease it acquired
- LB9 — When a conversation's lease ends, the conversation is bound to the earliest-acquired lease of its repository and branch still held, never another app's lease of the same branch, a lease of another branch or one no longer held; with none it stays unbound
- LB10 — A conversation whose lease another conversation acquired again is bound next to the earliest-acquired lease of its branch still held that the other did not lease in that call
- LB11 — A lease handed out again under the same alias while no call read it unbinds the conversation bound to the lease before, whether the new lease is of the same branch or another
- LB12 — The conversation that acquired an alias handed out again stays bound at a later read of that lease, even while the last checked read still names the lease before
