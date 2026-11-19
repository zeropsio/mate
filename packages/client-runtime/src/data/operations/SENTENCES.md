next: OP15

- OP1 — A second retry press while its answer is pending sends no second write
- OP2 — A request id cannot be reused to act on another Mate
- OP3 — An accepted operation is reflected and then done only when its owner says it ended, never by a clock
- OP4 — After a lost answer an operation asks its owner by the original request id and sends nothing twice
- OP5 — After a lost answer a Zerops operation adopts only one new process that no other operation holds; a process that ran before the send, or two new ones, adopt nothing
- OP6 — Only a synchronous refusal of the target write proves that Zerops refused it
- OP7 — After a lost answer a service start adopts only a start running for its own service and is never sent again
- OP8 — A Mate's restart starts a failed container only once its stop's process has ended, never by a clock
- OP9 — A Mate's restart whose stop can no longer be observed ends unresolved and never starts the Mate
- OP10 — A project deletion succeeds on its project's proven deletion when its process's end went unseen
- OP11 — An uncertain project creation goes on with its one new project and never makes a second
- OP12 — A rename and a tag write to one project never undo each other
- OP13 — A dropped socket or the same boot proves no outcome of a Mate's update
- OP14 — A press answered during a reboot waits for the boot after the one that answered
