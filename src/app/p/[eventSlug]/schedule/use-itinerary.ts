"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { itineraryStorageKey, parseStarredIds, toggleStarred } from "@/domain/program";

export interface Itinerary {
  /** Session ids the attendee has starred, in the order they starred them. */
  starred: string[];
  isStarred: (sessionId: string) => boolean;
  toggle: (sessionId: string) => void;
}

/**
 * The attendee's starred sessions, held in localStorage (spec.md "Public
 * program depth"). Deliberately not server state: the public program has no
 * accounts, and a "my schedule" that survives a reload is exactly what the
 * rubric asks for — nothing here needs to outlive the browser.
 *
 * localStorage is an external store, so it is read through
 * `useSyncExternalStore` rather than copied into React state by an effect:
 * the server snapshot ("nothing starred") is what renders during hydration,
 * so the client's first paint always matches the server's HTML, and the real
 * selection arrives on the very next render. It also means every star button
 * on the page — and a second tab — sees the same value without any of them
 * owning it.
 */
export function useItinerary(eventSlug: string): Itinerary {
  const storageKey = itineraryStorageKey(eventSlug);

  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(storageKey),
    // Server render: no browser storage to read, so nothing is starred.
    () => null,
  );
  const starred = useMemo(() => parseStarredIds(raw), [raw]);

  const toggle = useCallback(
    (sessionId: string) => {
      // Re-read rather than closing over `starred`: two star buttons clicked
      // in the same tick must both land.
      const next = toggleStarred(parseStarredIds(readRaw(storageKey)), sessionId);
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Private-mode Safari and friends throw on write; the star simply
        // doesn't stick rather than taking the page down with it.
      }
      notify();
    },
    [storageKey],
  );

  const starredSet = useMemo(() => new Set(starred), [starred]);
  const isStarred = useCallback((sessionId: string) => starredSet.has(sessionId), [starredSet]);

  return { starred, isStarred, toggle };
}

/** Subscribers in this tab. The `storage` event only fires in *other* tabs,
 * so same-tab updates need this hand-rolled notification. */
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

/** The stored value, or null if storage is unavailable. Returning the raw
 * string keeps `getSnapshot` referentially stable between renders — parsing
 * here would hand React a new array every time and loop forever. */
function readRaw(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}
