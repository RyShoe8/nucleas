import type { IRecording } from '@/lib/models/Recording';
import type { MediaUploadTarget } from '@/lib/mediaUploadTarget';
import { mediaTargetToRecordingFields } from '@/lib/mediaUploadTarget';

export type RecordingUploadResult = Pick<
  IRecording,
  'videoUrl' | 'audioUrl' | 'status' | 'transcript' | 'summary'
> & { id: string };

async function uploadViaBlobClient(
  file: File,
  pathname: string
): Promise<string> {
  const { upload } = await import('@vercel/blob/client');
  const blob = await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/recordings/upload',
  });
  return blob.url;
}

function recordingFileExtension(file: File): string {
  if (file.type === 'video/mp4' || file.name.endsWith('.mp4')) return 'mp4';
  if (file.type === 'audio/mp4' || file.name.endsWith('.m4a')) return 'm4a';
  if (file.type.includes('webm') || file.name.endsWith('.webm')) return 'webm';
  return 'mp4';
}

async function uploadRecordingFiles(
  videoFile: File,
  audioFile: File | null,
  orgHint: string
): Promise<{ videoUrl: string; audioUrl?: string }> {
  const timestamp = Date.now();
  const useBlobClient = typeof window !== 'undefined';
  const videoExt = recordingFileExtension(videoFile);

  if (useBlobClient) {
    try {
      const videoUrl = await uploadViaBlobClient(
        videoFile,
        `recordings/${orgHint}/${timestamp}-video.${videoExt}`
      );
      let audioUrl: string | undefined;
      if (audioFile) {
        const audioExt = recordingFileExtension(audioFile);
        audioUrl = await uploadViaBlobClient(
          audioFile,
          `recordings/${orgHint}/${timestamp}-audio.${audioExt}`
        );
      }
      return { videoUrl, audioUrl };
    } catch {
      // Fall through to multipart when blob client unavailable (local dev).
    }
  }

  return { videoUrl: '', audioUrl: undefined };
}

export async function createRecording(
  videoFile: File,
  audioFile: File | null,
  options: {
    title: string;
    duration: number;
    target?: MediaUploadTarget | null;
  }
): Promise<RecordingUploadResult> {
  const title = options.title.trim() || 'Recording';
  const targetFields = mediaTargetToRecordingFields(options.target ?? null);

  const blobUrls = await uploadRecordingFiles(videoFile, audioFile, 'client');

  if (blobUrls.videoUrl) {
    const response = await fetch('/api/recordings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        duration: options.duration,
        videoUrl: blobUrls.videoUrl,
        audioUrl: blobUrls.audioUrl,
        ...targetFields,
      }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(typeof data.error === 'string' ? data.error : 'Failed to save recording.');
    }
    const data = await response.json();
    return {
      id: data.id,
      videoUrl: data.videoUrl,
      audioUrl: data.audioUrl,
      status: data.status,
    };
  }

  const formData = new FormData();
  formData.append('video', videoFile);
  if (audioFile) formData.append('audio', audioFile);
  formData.append('title', title);
  formData.append('duration', String(options.duration));
  if (targetFields.projectId) formData.append('projectId', targetFields.projectId);
  if (targetFields.taskId) formData.append('taskId', targetFields.taskId);
  if (targetFields.contentItemId) formData.append('contentItemId', targetFields.contentItemId);

  const response = await fetch('/api/recordings', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to upload recording.');
  }

  const data = await response.json();
  return {
    id: data.id,
    videoUrl: data.videoUrl,
    audioUrl: data.audioUrl,
    status: data.status,
  };
}

export async function triggerRecordingProcess(recordingId: string): Promise<void> {
  const response = await fetch(`/api/recordings/${recordingId}/process`, {
    method: 'POST',
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.error === 'string' ? data.error : 'Failed to process recording.');
  }
}

export async function pollRecordingUntilSettled(
  recordingId: string,
  onUpdate?: (recording: Partial<IRecording> & { id: string }) => void
): Promise<Partial<IRecording> & { id: string }> {
  const maxAttempts = 90;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(`/api/recordings/${recordingId}`);
    if (!response.ok) {
      throw new Error('Failed to fetch recording status.');
    }
    const recording = await response.json();
    onUpdate?.(recording);
    if (recording.status === 'complete' || recording.status === 'failed') {
      return recording;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Recording processing timed out.');
}

export function downloadVideoFile(file: File, name: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  const safeName = name.replace(/[^\w\s.-]/g, '').trim() || 'recording';
  const defaultExt = file.type === 'video/mp4' || file.name.endsWith('.mp4') ? '.mp4' : '.webm';
  link.download = safeName.includes('.') ? safeName : `${safeName}${defaultExt}`;
  link.click();
  URL.revokeObjectURL(url);
}
