'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';

type RecordingDetail = {
  _id: string;
  title: string;
  videoUrl: string;
  duration: number;
  status: string;
  errorMessage?: string;
  transcript?: string;
  summary?: string;
  projectId?: string;
  createdAt: string;
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RecordingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const recordingId = params.id as string;

  const [recording, setRecording] = useState<RecordingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  const loadRecording = async () => {
    try {
      const res = await fetch(`/api/recordings/${recordingId}`);
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) {
        router.push('/');
        return;
      }
      const data = await res.json();
      setRecording(data);
      return data as RecordingDetail;
    } catch {
      router.push('/');
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRecording();
  }, [recordingId]);

  useEffect(() => {
    if (!recording || recording.status === 'complete' || recording.status === 'failed') return;

    setProcessing(true);
    const interval = window.setInterval(async () => {
      const updated = await loadRecording();
      if (updated?.status === 'complete' || updated?.status === 'failed') {
        setProcessing(false);
        window.clearInterval(interval);
      }
    }, 3000);

    return () => window.clearInterval(interval);
  }, [recording?.status, recordingId]);

  const retryProcessing = async () => {
    setProcessing(true);
    try {
      await fetch(`/api/recordings/${recordingId}/process`, { method: 'POST' });
      await loadRecording();
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-text-secondary">Loading recording…</p>
      </div>
    );
  }

  if (!recording) return null;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-text-muted hover:underline">
            ← Back to workspace
          </Link>
          <h1 className="text-2xl font-semibold text-text-primary mt-1">{recording.title}</h1>
          <p className="text-sm text-text-secondary mt-1">
            {formatDuration(recording.duration)} ·{' '}
            {new Date(recording.createdAt).toLocaleString()}
          </p>
        </div>
        <span
          className={`text-xs font-medium px-2 py-1 rounded-full ${
            recording.status === 'complete'
              ? 'bg-success/10 text-success'
              : recording.status === 'failed'
                ? 'bg-error/10 text-error'
                : 'bg-warning/10 text-warning'
          }`}
        >
          {recording.status}
        </span>
      </div>

      <Card className="overflow-hidden p-0">
        <video
          src={recording.videoUrl}
          controls
          className="w-full bg-black max-h-[70vh]"
          playsInline
        />
      </Card>

      {recording.status === 'failed' && (
        <Card className="p-4 space-y-3">
          <p className="text-sm text-error">
            {recording.errorMessage || 'Processing failed.'}
          </p>
          <Button type="button" size="sm" onClick={() => void retryProcessing()} disabled={processing}>
            Retry processing
          </Button>
        </Card>
      )}

      {(recording.status === 'processing' || processing) && (
        <Card className="p-4">
          <p className="text-sm text-text-secondary">
            Generating transcript and summary…
          </p>
        </Card>
      )}

      {recording.summary && (
        <Card className="p-4 space-y-2">
          <h2 className="text-lg font-medium text-text-primary">Summary</h2>
          <p className="text-sm text-text-secondary whitespace-pre-wrap">{recording.summary}</p>
        </Card>
      )}

      {recording.transcript && (
        <Card className="p-4 space-y-2">
          <h2 className="text-lg font-medium text-text-primary">Transcript</h2>
          <div className="max-h-96 overflow-y-auto text-sm text-text-secondary whitespace-pre-wrap">
            {recording.transcript}
          </div>
        </Card>
      )}
    </div>
  );
}
