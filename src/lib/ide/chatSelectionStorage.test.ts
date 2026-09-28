import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ideHrefForNavigation,
  readStoredIdeChatMode,
  readStoredIdeDirectSelection,
  readStoredIdeDraft,
  readStoredIdeLayout,
  readStoredIdeProjectId,
  resolveInitialIdeProjectId,
  writeStoredIdeChatMode,
  writeStoredIdeDirectSelection,
  writeStoredIdeDraft,
  writeStoredIdeLayout,
  writeStoredIdeProjectId,
} from '@/lib/ide/chatSelectionStorage';
import { IDE_FREE_CHAT_SCOPE } from '@/lib/ide/freeChat';

const store = new Map<string, string>();
const session = new Map<string, string>();

afterEach(() => {
  store.clear();
  session.clear();
  vi.unstubAllGlobals();
});

function stubStorage() {
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  });
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => session.get(key) ?? null,
    setItem: (key: string, value: string) => {
      session.set(key, value);
    },
    removeItem: (key: string) => {
      session.delete(key);
    },
    clear: () => session.clear(),
    key: () => null,
    length: 0,
  });
}

describe('chatSelectionStorage', () => {
  it('persists and restores mode per project', () => {
    stubStorage();
    writeStoredIdeChatMode('proj-a', 'direct');
    writeStoredIdeChatMode('proj-b', 'orchestrated');
    expect(readStoredIdeChatMode('proj-a')).toBe('direct');
    expect(readStoredIdeChatMode('proj-b')).toBe('orchestrated');
    expect(readStoredIdeChatMode('missing')).toBeNull();
  });

  it('normalizes legacy mode ids', () => {
    stubStorage();
    store.set('nucleas.ide.chatMode.proj', 'build');
    expect(readStoredIdeChatMode('proj')).toBe('orchestrated');
  });

  it('persists Direct company and model', () => {
    stubStorage();
    writeStoredIdeDirectSelection('proj', { profileId: ' prof ', model: ' local/m ' });
    expect(readStoredIdeDirectSelection('proj')).toEqual({
      profileId: 'prof',
      model: 'local/m',
    });
  });

  it('ignores incomplete Direct payloads', () => {
    stubStorage();
    store.set('nucleas.ide.directSelection.proj', JSON.stringify({ profileId: 'only' }));
    expect(readStoredIdeDirectSelection('proj')).toBeNull();
  });

  it('persists last project id and builds IDE nav href', () => {
    stubStorage();
    const id = 'a'.repeat(24);
    writeStoredIdeProjectId(id);
    expect(readStoredIdeProjectId()).toBe(id);
    expect(ideHrefForNavigation()).toBe(`/ide?projectId=${id}`);
    writeStoredIdeProjectId(IDE_FREE_CHAT_SCOPE);
    expect(readStoredIdeProjectId()).toBe(id);
    expect(ideHrefForNavigation()).toBe(`/ide?projectId=${id}`);
  });

  it('resolveInitialIdeProjectId prefers URL then stored real project', () => {
    stubStorage();
    const stored = 'c'.repeat(24);
    const url = 'd'.repeat(24);
    store.set('nucleas.ide.lastProjectId', stored);
    expect(resolveInitialIdeProjectId(url)).toBe(url);
    expect(resolveInitialIdeProjectId()).toBe(stored);
    store.delete('nucleas.ide.lastProjectId');
    expect(resolveInitialIdeProjectId()).toBe(IDE_FREE_CHAT_SCOPE);
  });

  it('persists layout snapshot per project', () => {
    stubStorage();
    const id = 'b'.repeat(24);
    writeStoredIdeLayout(id, {
      treeCollapsed: true,
      expandedPaths: { 'src/lib': true },
      activePath: 'src/lib/ide/modes.ts',
      rulesOpen: true,
      centerView: 'plan',
    });
    expect(readStoredIdeLayout(id)).toEqual({
      treeCollapsed: true,
      expandedPaths: { 'src/lib': true },
      activePath: 'src/lib/ide/modes.ts',
      rulesOpen: true,
      centerView: 'plan',
    });
  });

  it('persists composer draft in sessionStorage', () => {
    stubStorage();
    writeStoredIdeDraft('proj:worker', 'hello draft');
    expect(readStoredIdeDraft('proj:worker')).toBe('hello draft');
    writeStoredIdeDraft('proj:worker', '   ');
    expect(readStoredIdeDraft('proj:worker')).toBe('');
  });
});
