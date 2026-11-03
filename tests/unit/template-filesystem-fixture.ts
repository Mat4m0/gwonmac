// The mounted template directories, as a fake of the one Emscripten object the
// generated glue publishes. The fake is a tree in a Map rather than a recording
// of calls, because every claim made with it is about what the game would find
// afterwards — not about which method was reached.

import type { TemplateFileSystem } from "../../src/renderer/template-store.js";

export const SKILLS_DIR = "/app:/Templates/Skills";
export const EQUIPMENT_DIR = "/app:/Templates/Equipment";

export interface Fake extends TemplateFileSystem {
  files: Map<string, string>;
  directories: Set<string>;
  syncs: number;
  /** Held so a test can observe what applyImport does before the sync answers. */
  settleSync: (() => void) | null;
}

export function fakeFilesystem(files: Record<string, string> = {}, deferSync = false): Fake {
  const fake: Fake = {
    files: new Map(Object.entries(files)),
    directories: new Set([SKILLS_DIR, EQUIPMENT_DIR]),
    syncs: 0,
    settleSync: null,

    readdir(path) {
      const prefix = `${path}/`;
      const names = new Set<string>();
      for (const file of fake.files.keys()) {
        if (file.startsWith(prefix)) names.add(file.slice(prefix.length).split("/")[0] ?? "");
      }
      for (const directory of fake.directories) {
        if (directory.startsWith(prefix)) {
          names.add(directory.slice(prefix.length).split("/")[0] ?? "");
        }
      }
      if (!fake.directories.has(path)) throw new Error(`no such directory: ${path}`);
      return [".", "..", ...names];
    },
    stat(path) {
      if (fake.directories.has(path)) return { mode: 1 };
      if (fake.files.has(path)) return { mode: 2 };
      throw new Error(`no such path: ${path}`);
    },
    isDir: (mode) => mode === 1,
    isFile: (mode) => mode === 2,
    readFile(path) {
      const contents = fake.files.get(path);
      if (contents === undefined) throw new Error(`no such file: ${path}`);
      return contents;
    },
    writeFile(path, data) {
      fake.files.set(path, data);
    },
    unlink(path) {
      if (!fake.files.delete(path)) throw new Error(`no such file: ${path}`);
    },
    rmdir(path) {
      const prefix = `${path}/`;
      const occupied = [...fake.files.keys(), ...fake.directories].some(
        (known) => known.startsWith(prefix),
      );
      if (occupied) throw new Error(`not empty: ${path}`);
      fake.directories.delete(path);
    },
    mkdirTree(path) {
      const segments = path.split("/");
      for (let index = 2; index <= segments.length; index += 1) {
        fake.directories.add(segments.slice(0, index).join("/"));
      }
    },
    analyzePath: (path) => ({
      exists: fake.files.has(path) || fake.directories.has(path),
    }),
    syncfs(_populate, callback) {
      fake.syncs += 1;
      if (deferSync) fake.settleSync = () => callback();
      else callback();
    },
  };
  for (const file of fake.files.keys()) {
    const cut = file.lastIndexOf("/");
    fake.mkdirTree(file.slice(0, cut));
  }
  return fake;
}
