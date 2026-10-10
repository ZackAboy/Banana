import { describe, expect, it, vi } from "vitest";
import { MemoryCache } from "@/lib/cache/memory";
describe("bounded TTL cache", () => {
  it("deduplicates concurrent loads and reuses a cached result", async () => {
    const cache = new MemoryCache();
    const loader = vi.fn(async () => 42);
    expect(
      await Promise.all([
        cache.getOrLoad("a", loader),
        cache.getOrLoad("a", loader),
      ]),
    ).toEqual([42, 42]);
    expect(await cache.getOrLoad("a", loader)).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("expires entries and evicts old keys when bounded", async () => {
    let now = 0;
    const cache = new MemoryCache(10, 1, () => now);
    const loader = vi.fn(async () => "result");
    await cache.getOrLoad("a", loader);
    now = 11;
    await cache.getOrLoad("a", loader);
    expect(loader).toHaveBeenCalledTimes(2);
    await cache.getOrLoad("b", loader);
    await cache.getOrLoad("a", loader);
    expect(loader).toHaveBeenCalledTimes(4);
  });
  it("does not cache failures or leave a failed inflight request", async () => {
    const cache = new MemoryCache();
    await expect(
      cache.getOrLoad("a", async () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    expect(await cache.getOrLoad("a", async () => "recovered")).toBe(
      "recovered",
    );
  });
});
