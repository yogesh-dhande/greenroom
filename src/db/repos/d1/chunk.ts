/**
 * D1 rejects a statement carrying more than 100 bound parameters, so an
 * `inArray(column, ids)` lookup is only safe while the caller's id list stays
 * short. Batch reads that can grow past that run in slices instead.
 *
 * Kept below the real ceiling to leave room for the handful of parameters a
 * query binds alongside the id list (an `eq` on a status column, a limit).
 */
const MAX_IDS_PER_STATEMENT = 90;

/**
 * Runs `query` over `ids` in D1-sized slices and concatenates the rows.
 *
 * A single statement is issued whenever the list fits, which is the normal
 * case — the slicing only exists so that a long list degrades into a few more
 * round trips rather than a runtime error. Rows come back in slice order, so a
 * caller that needs a total ordering across slices has to impose it (see
 * `listByIds` in ./events.ts); callers that index the rows by id do not care.
 */
export async function inIdChunks<Id, Row>(
  ids: readonly Id[],
  query: (chunk: Id[]) => Promise<Row[]>,
): Promise<Row[]> {
  if (ids.length === 0) return [];
  if (ids.length <= MAX_IDS_PER_STATEMENT) return query([...ids]);

  const rows: Row[] = [];
  for (let start = 0; start < ids.length; start += MAX_IDS_PER_STATEMENT) {
    rows.push(...(await query(ids.slice(start, start + MAX_IDS_PER_STATEMENT))));
  }
  return rows;
}
