// Settings modules read localStorage as they load. A test file that imports one, directly or not, imports this
// first, so it runs on its own and in any order: other files may have set their own stub already, which stays.
const store = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};
