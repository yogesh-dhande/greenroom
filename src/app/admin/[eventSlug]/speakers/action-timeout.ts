/**
 * Races a server-action call against a fixed timeout, so a Worker that never
 * answers the request doesn't leave a dialog disabled on "Adding…" forever
 * (eval finding: the deployed Worker dropped the request and the button
 * never re-enabled — src/app/admin/[eventSlug]/speakers/add-speaker-dialog.tsx,
 * import-speakers-dialog.tsx).
 *
 * Deliberately not a retry system: on timeout the caller decides what to
 * tell the user, and the underlying action may well complete server-side
 * after the client gives up on it — the caller's message should say so
 * rather than implying the attempt was undone.
 */

export class ActionTimeoutError extends Error {
  constructor(message = "The server didn't respond in time.") {
    super(message);
    this.name = "ActionTimeoutError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function withActionTimeout<T>(promise: Promise<T>, ms: number = DEFAULT_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ActionTimeoutError()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
