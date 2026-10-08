/** Tiny in-process TTL cache with in-flight de-duplication (stampede protection). For multi-instance use swap for Redis. */
export class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>();
  private inflight = new Map<string, Promise<T>>();
  constructor(private ttlMs: number) {}
  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.store.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = load().then((value) => {
      this.store.set(key, { at: Date.now(), value });
      return value;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
  clear() { this.store.clear(); }
}
