// PostgREST returns at most max_rows rows per request (1000 on Supabase) and silently drops the rest.
// fetchAll pages with range() until the exact count has arrived, whatever max_rows is.
// The query must request { count: "exact" } and have a stable order (the primary key, for instance).
export const PAGE_SIZE = 1000;

type Page<Row> = { data: Row[] | null; error: unknown; count: number | null };

// null on any error, or without a count to check against: never a partial result.
export async function fetchAll<Row>(page: (from: number, to: number) => PromiseLike<Page<Row>>): Promise<Row[] | null> {
  const rows: Row[] = [];
  for (;;) {
    const { data, error, count } = await page(rows.length, rows.length + PAGE_SIZE - 1);
    if (error || !data || count === null) return null;
    rows.push(...data);
    if (data.length === 0 || rows.length >= count) return rows;
  }
}
