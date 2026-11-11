/**
 * Fetches EVERY row of a query, past PostgREST's response cap. Supabase caps a
 * single response at `max_rows` (1000 by default) and silently drops the rest
 * -- no error -- so an unbounded "whole history" select (every frame ever, for
 * stats) quietly loses data once an account grows past it.
 *
 * `page(from, to)` must build the query fresh each call, select with
 * `{ count: 'exact' }`, and order by a unique column (e.g. `id`) so pages
 * neither overlap nor skip rows. The first page reports the total; the rest
 * are fetched in parallel. The page size actually used is whatever the server
 * returned for the first page, so a project with a lower cap still works.
 */
export async function fetchAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; count: number | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const first = await page(0, pageSize - 1);
  if (first.error) throw first.error;
  const rows = first.data ?? [];
  const total = first.count ?? rows.length;
  const step = rows.length;
  if (step === 0 || rows.length >= total) return rows;

  const starts: number[] = [];
  for (let from = step; from < total; from += step) starts.push(from);
  const rest = await Promise.all(
    starts.map(async (from) => {
      const res = await page(from, from + step - 1);
      if (res.error) throw res.error;
      return res.data ?? [];
    }),
  );
  return rows.concat(...rest);
}
