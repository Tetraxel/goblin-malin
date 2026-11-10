/**
 * Lets one run of an async job go at a time. `run(job)` starts the job unless one is already in flight, in which
 * case it resolves `false` without starting another (a held-down key repeats faster than the job can show that
 * it is busy). It resolves `true` once the job it started has finished, and rejects with the job's error; the
 * guard is released either way.
 */
export function createSingleFlight(): { run(job: () => Promise<void>): Promise<boolean>; readonly busy: boolean } {
    let busy = false;
    return {
        async run(job) {
            if (busy) return false;
            busy = true;
            try {
                await job();
                return true;
            } finally {
                busy = false;
            }
        },
        get busy() {
            return busy;
        },
    };
}
