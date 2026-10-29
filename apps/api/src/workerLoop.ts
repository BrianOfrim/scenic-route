/** Coalesce wakeups, including those arriving during a tick, without overlapping ticks. */
export function createWorkerLoop(tick: () => Promise<boolean>, options: {
    idleMs: number;
    onError: (error: unknown) => void;
    schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
    cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
    const schedule = options.schedule ?? setTimeout;
    const cancel = options.cancel ?? clearTimeout;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current: Promise<void> | undefined;
    let requested = false;
    let stopped = false;
    const plan = (delay: number) => {
        if (timer !== undefined) cancel(timer);
        timer = schedule(() => { timer = undefined; void run(); }, delay);
    };
    const run = () => {
        if (stopped) return;
        if (current) { requested = true; return; }
        requested = false;
        current = (async () => {
            let active = false;
            try { active = await tick(); }
            catch (error) { options.onError(error); }
            finally {
                current = undefined;
                if (!stopped) plan(requested ? 0 : active ? 1000 : options.idleMs);
            }
        })();
    };
    return {
        wake() {
            if (stopped) return;
            if (current) requested = true;
            else plan(0);
        },
        async stop() {
            stopped = true;
            if (timer !== undefined) cancel(timer);
            await current;
        },
    };
}
