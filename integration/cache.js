// A small in-memory cache with expiry, for the countries list. It lives in this process: with several processes or
// servers, use a shared cache (Redis, Memcached, or a table) so they don't each call restcountries.com.
const entries = new Map();

export const cache = {
  /** The value, or undefined when it is missing or expired. */
  get(key) {
    const entry = entries.get(key);
    if (entry && entry.expires > Date.now()) return entry.value;
    entries.delete(key);
    return undefined;
  },
  has(key) {
    return this.get(key) !== undefined;
  },
  set(key, value, ttlMs) {
    entries.set(key, { value, expires: Date.now() + ttlMs });
  },
  clear() {
    entries.clear();
  },
};
