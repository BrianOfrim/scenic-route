import { useSyncExternalStore } from "react";

export type ArrivedPoster = { posterId: string };

let epoch = 0;
let arrived: ArrivedPoster[] = [];
const listeners = new Set<() => void>();

function publish() {
  epoch += 1;
  listeners.forEach((listener) => listener());
}

/** Record images as soon as their generate call returns, before the rest of the batch finishes. */
export function noteArrivedPosters(posters: ArrivedPoster[]) {
  const seen = new Set(arrived.map((item) => item.posterId));
  const fresh = posters.filter((item) => item.posterId && !seen.has(item.posterId));
  if (!fresh.length) return;
  arrived = [...arrived, ...fresh];
  publish();
}

/** Drop a deleted image so a later completion does not put it back. */
export function forgetArrivedPoster(posterId: string) {
  const next = arrived.filter((item) => item.posterId !== posterId);
  if (next.length === arrived.length) return;
  arrived = next;
}

export function getArrivedPosters<T extends ArrivedPoster>(): T[] {
  return arrived as T[];
}

export function getArrivedEpoch() {
  return epoch;
}

export function subscribeArrived(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useArrivedEpoch() {
  return useSyncExternalStore(subscribeArrived, getArrivedEpoch, getArrivedEpoch);
}
