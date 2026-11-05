/**
 * Many small asks as one request (test report 1, item 21): the Anime page's genre shelves each
 * wanted their own AniList request, so scrolling past ten queued ten behind a rate limit. Asks that
 * come within `wait` ms of each other go together, at most `max` at a time; each gets its own answer.
 * A failed request fails every ask in it.
 */
export function batcher<K, V>(run: (keys: K[]) => Promise<V[]>, { wait = 50, max = 6 } = {}): (key: K) => Promise<V> {
  type Ask = { key: K; resolve: (v: V) => void; reject: (e: unknown) => void };
  let queue: Ask[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    timer = undefined;
    const batch = queue.slice(0, max);
    queue = queue.slice(max);
    if (queue.length) timer = setTimeout(flush, 0);
    run(batch.map((a) => a.key)).then(
      (values) => batch.forEach((a, i) => a.resolve(values[i])),
      (e: unknown) => batch.forEach((a) => a.reject(e)),
    );
  };
  return (key) =>
    new Promise<V>((resolve, reject) => {
      queue.push({ key, resolve, reject });
      if (queue.length >= max) {
        clearTimeout(timer);
        flush();
      } else timer ??= setTimeout(flush, wait);
    });
}
