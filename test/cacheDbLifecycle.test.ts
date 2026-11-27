import { afterEach, describe, expect, it } from "vitest";

import {
  closeCacheDb,
  getCacheDb,
  resetCacheDb,
} from "../src/modules/cache/db";

interface FakeConnection {
  path: string;
  queryAsync: () => Promise<unknown[]>;
  closeDatabase: (permanent: boolean) => Promise<void>;
}

function installFakeZotero(openGate?: Promise<void>) {
  const connections: Array<FakeConnection & { closes: boolean[] }> = [];

  class DBConnection {
    path: string;
    closes: boolean[] = [];
    private firstQuery = true;

    constructor(path: string) {
      this.path = path;
      connections.push(this);
    }

    async queryAsync(): Promise<unknown[]> {
      if (this.firstQuery) {
        this.firstQuery = false;
        await openGate;
      }
      return [];
    }

    async closeDatabase(permanent: boolean): Promise<void> {
      this.closes.push(permanent);
    }
  }

  Object.assign(globalThis, {
    Zotero: {
      DBConnection,
      DataDirectory: {
        dir: "/tmp/zotero-test",
        getDatabase: (name: string) => `/tmp/zotero-test/${name}.sqlite`,
      },
    },
  });

  return connections;
}

afterEach(() => {
  resetCacheDb();
  Reflect.deleteProperty(globalThis, "Zotero");
});

describe("cache database lifecycle", () => {
  it("shares one connection while the database is opening", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connections = installFakeZotero(gate);

    const first = getCacheDb();
    const second = getCacheDb();

    expect(connections).toHaveLength(1);
    release();
    expect(await first).toBe(await second);
    expect(connections).toHaveLength(1);
  });

  it("waits for opening, closes permanently, and refuses to reopen", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const connections = installFakeZotero(gate);

    const opening = getCacheDb();
    const closing = closeCacheDb();
    release();
    await Promise.all([opening, closing]);

    expect(connections).toHaveLength(1);
    expect(connections[0].closes).toEqual([true]);
    expect(await getCacheDb()).toBeNull();
    expect(connections).toHaveLength(1);
  });
});
