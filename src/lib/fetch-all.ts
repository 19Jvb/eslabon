// PostgREST returns at most max_rows rows per request (1000 on Supabase) and silently drops the rest.
// fetchAll pages by key until every row has arrived, whatever max_rows is: page(after) must return the rows
// that come after `after` in a stable order (undefined: from the start), with { count: "exact" } of those rows.
// By key, not by offset: a row deleted between pages cannot shift the next page and skip one that still exists.
export const PAGE_SIZE = 1000;

type Page<Row> = { data: Row[] | null; error: unknown; count: number | null };

// null on any error, or without a count to check against: never a partial result.
export async function fetchAll<Row>(page: (after: Row | undefined) => PromiseLike<Page<Row>>): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error, count } = await page(rows.at(-1));
    if (error || !data || count === null) return null;
    rows.push(...data);
    if (data.length === 0 || data.length >= count) return rows;
  }
}
