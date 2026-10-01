export type ReferenceBatch = { referenceBatchId: string; expiresAt: number };

/** Keep one upload shared across plans, models, variants, and retry closures. */
export function createReferenceUploadCache(upload: (images: string[]) => Promise<ReferenceBatch>) {
  let current: { images: string[]; promise: Promise<ReferenceBatch>; expiresAt: number } | undefined;
  return (images: string[]) => {
    if (current && current.expiresAt > Date.now() && images.length === current.images.length && images.every((image, i) => image === current!.images[i])) {
      return current.promise;
    }
    const entry = { images: [...images], promise: null! as Promise<ReferenceBatch>, expiresAt: Infinity };
    entry.promise = upload(images).then(result => {
      entry.expiresAt = result.expiresAt;
      return result;
    }).catch(error => {
      if (current === entry) current = undefined;
      throw error;
    });
    current = entry;
    return entry.promise;
  };
}
