import { describe, expect, it } from 'vitest';
import { windowLabel } from './windowLabel';
import type { ModuleDefinition } from './types';

const base = { id: 'company', title: 'Company', icon: '🏢', defaultSize: { width: 1, height: 1 }, minSize: { width: 1, height: 1 }, canPopout: true, permissions: 'member', render: () => null } as ModuleDefinition;

describe('windowLabel', () => {
  it('uses the module per-window title when present', () => {
    const mod = { ...base, windowTitle: (p?: Record<string, string>) => p?.companyName };
    expect(windowLabel({ moduleId: 'company', payload: { companyId: '1', companyName: 'Frugal Gambler' } }, mod)).toBe('Frugal Gambler');
  });

  it('falls back to the module title, then the module id', () => {
    const mod = { ...base, windowTitle: (p?: Record<string, string>) => p?.companyName };
    expect(windowLabel({ moduleId: 'company', payload: {} }, mod)).toBe('Company');
    expect(windowLabel({ moduleId: 'unknown' }, undefined)).toBe('unknown');
  });
});
