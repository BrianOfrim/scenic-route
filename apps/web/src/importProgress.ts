export type ImportProgress = {
  processed: number;
  total: number;
  imported: number;
  skipped: number;
  failed: number;
};

export type ImportStatus = {
  phase: "preparing" | "importing" | "refreshing";
  progress?: ImportProgress;
};

// Network chunks can split a JSON line or a multi-byte filename anywhere.
export async function* readImportEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) yield JSON.parse(line);
      }
      if (done) break;
    }
    if (pending.trim()) yield JSON.parse(pending);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
