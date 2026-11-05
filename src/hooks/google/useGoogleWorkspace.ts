'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AssetLinkContext } from '@/components/checklist/categoryModalTypes';
import {
  buildGoogleConnectUrl,
  clearGoogleWorkspacePendingAction,
  readGoogleWorkspacePendingAction,
  saveGoogleWorkspacePendingAction,
  type GoogleWorkspacePendingAction,
} from '@/lib/google/clientUtils';

type WorkspaceStatus = {
  connected: boolean;
  loading: boolean;
};

function linkFieldsFromContext(
  ctx?: AssetLinkContext,
  projectId?: string,
  clientId?: string
): Record<string, string | number | undefined> {
  return {
    linkedProjectId: ctx?.linkedProjectId ?? projectId,
    linkedClientId: ctx?.linkedClientId ?? clientId,
    linkedContentItemId: ctx?.linkedContentItemId,
    linkedProjectTaskId: ctx?.linkedProjectTaskId,
    linkedProjectTaskIndex: ctx?.linkedProjectTaskIndex,
  };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    if (data?.error) return String(data.error);
  } catch {
    // ignore
  }
  return fallback;
}

export function useGoogleWorkspace(
  linkContext?: AssetLinkContext,
  projectId?: string,
  clientId?: string
) {
  const [status, setStatus] = useState<WorkspaceStatus>({ connected: false, loading: true });

  const refreshStatus = useCallback(async () => {
    setStatus((prev) => ({ ...prev, loading: true }));
    try {
      const res = await fetch('/api/google/workspace/status');
      const data = await res.json();
      setStatus({ connected: !!data.connected, loading: false });
      return !!data.connected;
    } catch {
      setStatus({ connected: false, loading: false });
      return false;
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('google_drive_connected') !== '1') return;
    params.delete('google_drive_connected');
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`;
    window.history.replaceState({}, '', next);
    const timer = window.setTimeout(() => {
      void refreshStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshStatus]);

  const ensureConnected = useCallback(
    async (pending: GoogleWorkspacePendingAction): Promise<boolean> => {
      const connected = status.connected || (await refreshStatus());
      if (connected) return true;
      saveGoogleWorkspacePendingAction(pending);
      // The desktop app cannot show Google's sign-in, so it continues in the browser.
      if (window.nucleasDesktop) window.open(buildGoogleConnectUrl(), '_blank');
      else window.location.href = buildGoogleConnectUrl(window.location.href);
      return false;
    },
    [refreshStatus, status.connected]
  );

  const createDoc = useCallback(
    async (name: string) => {
      const body = { name, ...linkFieldsFromContext(linkContext, projectId, clientId) };
      const res = await fetch('/api/google/workspace/docs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to create Google Doc'));
      return res.json();
    },
    [linkContext, projectId, clientId]
  );

  const createSheet = useCallback(
    async (name: string) => {
      const body = { name, ...linkFieldsFromContext(linkContext, projectId, clientId) };
      const res = await fetch('/api/google/workspace/sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to create Google Sheet'));
      return res.json();
    },
    [linkContext, projectId, clientId]
  );

  const attachPickedFile = useCallback(
    async (googleFileId: string, name?: string) => {
      const body = { googleFileId, name, ...linkFieldsFromContext(linkContext, projectId, clientId) };
      const res = await fetch('/api/google/workspace/files/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to attach file'));
      return res.json();
    },
    [linkContext, projectId, clientId]
  );

  const uploadFile = useCallback(
    async (file: File, name?: string) => {
      const form = new FormData();
      form.append('file', file);
      form.append('name', name?.trim() || file.name);
      const fields = linkFieldsFromContext(linkContext, projectId, clientId);
      for (const [key, value] of Object.entries(fields)) {
        if (value != null && value !== '') form.append(key, String(value));
      }
      const res = await fetch('/api/google/workspace/files/upload', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(await readApiError(res, 'Failed to upload file'));
      return res.json();
    },
    [linkContext, projectId, clientId]
  );

  return {
    status,
    refreshStatus,
    ensureConnected,
    createDoc,
    createSheet,
    attachPickedFile,
    uploadFile,
    readPendingAction: readGoogleWorkspacePendingAction,
    clearPendingAction: clearGoogleWorkspacePendingAction,
    savePendingAction: saveGoogleWorkspacePendingAction,
    linkFieldsFromContext: () => linkFieldsFromContext(linkContext, projectId, clientId),
  };
}
