import { AsyncLocalStorage } from "node:async_hooks";
/** Durable ownership is checked before each externally visible operation. */
export type ImageAttemptContext = {
    id: string;
    token: string;
    jobId: string;
    userId: string;
    nextPosterId(): string;
    check(): Promise<void>;
    dispatch(timeoutMs: number): Promise<void>;
    quota(id: string): Promise<void>;
    received(count: number): Promise<void>;
};
export const imageAttemptContext = new AsyncLocalStorage<ImageAttemptContext>();
