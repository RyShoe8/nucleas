import { beforeEach } from 'vitest';

process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'synthetic-test-secret-for-vitest-32-chars';

const storage = new Map<string, string>();

function installBrowserStorage(): void {
  Object.defineProperty(globalThis, 'window', {
    value: globalThis,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      },
      key: () => null,
      get length() {
        return storage.size;
      },
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  storage.clear();
  installBrowserStorage();
});
