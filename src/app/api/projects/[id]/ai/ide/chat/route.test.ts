import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Types } from 'mongoose';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  history: vi.fn(),
  append: vi.fn(),
  team: vi.fn(),
  direct: vi.fn(),
  rules: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/ai/control/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/ai/control/access')>()),
  requireAiProject: mocks.access,
}));
vi.mock('@/lib/ide/chatHistory', () => ({
  loadIdeChatHistory: mocks.history,
  appendIdeChatTurns: mocks.append,
  findExistingIdeAssistantTurn: vi.fn().mockResolvedValue(null),
  clearIdeChatTurnPlan: vi.fn(),
}));
vi.mock('@/lib/ai/teamChat', () => ({ attemptOrchestratedIdeReply: mocks.team }));
vi.mock('@/lib/ai/ideDirectChat', () => ({ attemptDirectModelChat: mocks.direct }));
vi.mock('@/lib/ide/loadTaskRules', () => ({ loadIdeTaskRuleTexts: mocks.rules }));

import { AiHttpError } from '@/lib/ai/control/access';
import { GET, POST } from '@/app/api/projects/[id]/ai/ide/chat/route';

const projectId = 'a'.repeat(24);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({
    organizationId: 'org',
    userId: 'u'.repeat(24),
    project: { _id: new Types.ObjectId(projectId), name: 'Demo' },
  });
  mocks.history.mockResolvedValue([{ requestId: 't1', role: 'user', text: 'hi' }]);
  mocks.rules.mockResolvedValue([]);
  mocks.append.mockResolvedValue(true);
});

describe('GET /api/projects/[id]/ai/ide/chat', () => {
  it('fails closed when project access is denied', async () => {
    mocks.access.mockRejectedValue(new AiHttpError(404, 'Unavailable.'));
    const request = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat?mode=orchestrated`
    );
    const response = await GET(request, { params: Promise.resolve({ id: projectId }) });
    expect(response.status).toBe(404);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid mode without a generic 503', async () => {
    const request = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat?mode=not-a-mode`
    );
    const response = await GET(request, { params: Promise.resolve({ id: projectId }) });
    expect(response.status).toBe(400);
    expect(mocks.history).not.toHaveBeenCalled();
  });

  it('loads history scoped by mode and Direct selection', async () => {
    const request = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat?mode=direct&modelProfileId=prof&model=local%2Fm`
    );
    const response = await GET(request, { params: Promise.resolve({ id: projectId }) });
    expect(response.status).toBe(200);
    expect(mocks.history).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org',
        mode: 'direct',
        modelProfileId: 'prof',
        model: 'local/m',
      })
    );
    await expect(response.json()).resolves.toMatchObject({
      mode: 'direct',
      turns: [{ requestId: 't1', role: 'user', text: 'hi' }],
    });
  });

  it('returns empty turns when history soft-fails', async () => {
    mocks.history.mockResolvedValue([]);
    const request = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat?mode=orchestrated`
    );
    const response = await GET(request, { params: Promise.resolve({ id: projectId }) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ mode: 'orchestrated', turns: [] });
  });
});

describe('POST /api/projects/[id]/ai/ide/chat', () => {
  it('persists the user turn before the orchestra and the assistant after', async () => {
    mocks.team.mockResolvedValue({
      requestId: 'a1',
      role: 'assistant',
      text: 'Rules are prompt-injected.',
      toolsUsed: ['repo_tree', 'repo_read'],
    });

    const request = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'orchestrated',
          text: 'how does our rules system work?',
          history: [],
          interactionMode: 'chat',
        }),
      }
    );
    const response = await POST(request, { params: Promise.resolve({ id: projectId }) });
    expect(response.status).toBe(200);
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append.mock.calls[0]?.[0]?.turns).toEqual([
      expect.objectContaining({ role: 'user', text: 'how does our rules system work?' }),
    ]);
    expect(mocks.append.mock.calls[1]?.[0]?.turns).toEqual([
      expect.objectContaining({ role: 'assistant', text: 'Rules are prompt-injected.' }),
    ]);
    expect(mocks.team).toHaveBeenCalled();
    const body = await response.json();
    expect(body.historyPersisted).toBe(true);
  });

  it('POST orchestrated mode then GET returns user and assistant turns', async () => {
    const persisted: { requestId: string; role: string; text: string }[] = [];
    mocks.append.mockImplementation(async (args: { turns: typeof persisted }) => {
      persisted.push(...args.turns);
      return true;
    });
    mocks.history.mockImplementation(async () => [...persisted]);
    mocks.team.mockResolvedValue({
      requestId: 'a2',
      role: 'assistant',
      text: 'Context loads from Mongo.',
      toolsUsed: [],
    });

    const postRequest = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'orchestrated',
          text: 'how do we handle context in our IDE?',
          history: [],
          interactionMode: 'chat',
        }),
      }
    );
    const postResponse = await POST(postRequest, { params: Promise.resolve({ id: projectId }) });
    expect(postResponse.status).toBe(200);

    const getRequest = new NextRequest(
      `https://nucleas.test/api/projects/${projectId}/ai/ide/chat?mode=orchestrated`
    );
    const getResponse = await GET(getRequest, { params: Promise.resolve({ id: projectId }) });
    expect(getResponse.status).toBe(200);
    const getBody = await getResponse.json();
    expect(getBody.turns.length).toBeGreaterThanOrEqual(2);
    expect(getBody.turns.some((t: { role: string }) => t.role === 'user')).toBe(true);
    expect(getBody.turns.some((t: { role: string }) => t.role === 'assistant')).toBe(true);
  });
});
