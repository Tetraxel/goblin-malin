import { type AgentToolContext } from "#base/agent/agentTool";

// Calls that are being answered now, by what they ask. The CLI gives up on a call that takes too long (a dialog the
// user is still reading) and the model may ask again; the second call joins the first instead of asking the user the
// same question twice, or doing the same thing twice. Within one message only: a call of the next message must not
// get the answer of a message that has ended ("nothing was started").
const inFlight = new Map<string, Promise<unknown>>();

/** Runs `work`, or waits for the same call (same turn, tool and `ids`) that is already running and shares its answer. */
export function joinSameCall<T>(
    tool: string,
    ctx: AgentToolContext,
    ids: readonly string[],
    work: () => Promise<T>
): Promise<T> {
    const key = `${ctx.turn.id}:${tool}:${[...new Set(ids)].sort().join(",")}`;
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const promise = work().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
}
