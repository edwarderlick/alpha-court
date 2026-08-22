/** Bounded-concurrency map. GET /api/claims and the leaderboard used to
 *  Promise.all every get_claim / get_passport at once, which is how this
 *  project's own testing kept slamming Studio's 30 req/min limit and
 *  turning a real navigation into a 70-second "dead link". */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  const n = Math.max(0, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}
