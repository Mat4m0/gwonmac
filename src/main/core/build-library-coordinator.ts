/**
 * Serializes each durable build library and rejects stale writes from another
 * window. IPC supplies an owned window and path; this owner keeps persistence
 * and optimistic-concurrency state behind that transport boundary.
 */
import type { BuildLibrary } from "../../shared/builds/library.js";
import { ValidationError } from "../../shared/errors.js";
import { loadBuildLibrary, saveBuildLibrary } from "./build-library.js";
import { Mutex } from "./mutex.js";

export class BuildLibraryCoordinator {
  private readonly baselines = new WeakMap<object, Map<string, string>>();
  private readonly locks = new Map<string, Mutex>();

  async get(
    owner: object,
    libraryPath: string,
  ): Promise<{ readonly library: BuildLibrary; readonly recovered: boolean }> {
    return this.lockFor(libraryPath).run(async () => {
      let recovered = false;
      const library = await loadBuildLibrary(libraryPath, () => {
        recovered = true;
      });
      this.remember(owner, libraryPath, library);
      return { library, recovered };
    });
  }

  async set(
    owner: object,
    libraryPath: string,
    library: BuildLibrary,
  ): Promise<BuildLibrary> {
    return this.lockFor(libraryPath).run(async () => {
      const current = await loadBuildLibrary(libraryPath);
      const expected = this.baselines.get(owner)?.get(libraryPath);
      if (expected === undefined || expected !== JSON.stringify(current)) {
        throw new ValidationError(
          "build library changed in another account; reload before saving",
        );
      }
      const saved = await saveBuildLibrary(libraryPath, library);
      this.remember(owner, libraryPath, saved);
      return saved;
    });
  }

  private lockFor(libraryPath: string): Mutex {
    let lock = this.locks.get(libraryPath);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(libraryPath, lock);
    }
    return lock;
  }

  private remember(owner: object, libraryPath: string, library: BuildLibrary): void {
    let values = this.baselines.get(owner);
    if (!values) {
      values = new Map();
      this.baselines.set(owner, values);
    }
    values.set(libraryPath, JSON.stringify(library));
  }
}
