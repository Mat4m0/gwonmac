/**
 * Runtime read-only facade for Maps held by shared certification caches.
 * Empty maps share one allocation; non-empty views share prototype methods.
 */
class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly #source: ReadonlyMap<K, V>;

  constructor(source: ReadonlyMap<K, V>) {
    this.#source = source;
    Object.freeze(this);
  }

  get size(): number { return this.#source.size; }
  get(key: K): V | undefined { return this.#source.get(key); }
  has(key: K): boolean { return this.#source.has(key); }
  entries(): MapIterator<[K, V]> { return this.#source.entries(); }
  keys(): MapIterator<K> { return this.#source.keys(); }
  values(): MapIterator<V> { return this.#source.values(); }
  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    this.#source.forEach((value, key) => callback(value, key, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> { return this.#source[Symbol.iterator](); }
}

const EMPTY_MAP_VIEW = new ReadonlyMapView(new Map<never, never>());

export function readonlyMapView<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return source.size === 0
    ? EMPTY_MAP_VIEW as ReadonlyMap<K, V>
    : new ReadonlyMapView(source);
}
