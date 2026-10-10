export class MemoryCache {
  private entries = new Map<string, { value: unknown; expiresAt: number }>();
  private pending = new Map<string, Promise<unknown>>();
  constructor(
    private ttlMs = 5 * 60_000,
    private maxEntries = 100,
    private now = Date.now,
  ) {}
  async getOrLoad<T>(key: string, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt > this.now()) return entry.value as T;
    this.entries.delete(key);
    const inflight = this.pending.get(key);
    if (inflight) return inflight as Promise<T>;
    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        for (const [oldKey, old] of this.entries)
          if (old.expiresAt <= this.now()) this.entries.delete(oldKey);
        if (this.entries.size >= this.maxEntries)
          this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
