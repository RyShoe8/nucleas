import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db/mongodb';
import Project from '@/lib/models/Project';
import { requireAuth } from '@/lib/auth/middleware';
import {
  findAccessibleRecording,
  getRecordingSessionContext,
} from '@/lib/recordings/recordingAccess';
import { transcribeAudioFromUrl } from '@/lib/ai/transcribeAudio';
import { summarizeRecording } from '@/lib/ai/summarizeRecording';
import { assertTrustedRecordingUrl } from '@/lib/recordings/recordingUrlPolicy';

export const maxDuration = 300;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireAuth(request);
    if (session instanceof NextResponse) return session;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI is not configured on this server.' },
        { status: 503 }
      );
    }

    await connectDB();
    const ctx = await getRecordingSessionContext(session.userId);
    if (ctx instanceof NextResponse) return ctx;

    const { id } = await params;
    const recording = await findAccessibleRecording(ctx, id);
    if (recording instanceof NextResponse) return recording;

    if (recording.status === 'complete') {
      return NextResponse.json({
        id: recording._id.toString(),
        status: recording.status,
        transcript: recording.transcript,
        summary: recording.summary,
      });
    }

    if (recording.status === 'processing') {
      recording.status = 'processing';
      await recording.save();
    }

    try {
      const audioSource = recording.audioUrl || recording.videoUrl;
      assertTrustedRecordingUrl(audioSource, {
        requestOrigin: new URL(request.url).origin,
        allowRelativeUploads: true,
      });
      const transcript = await transcribeAudioFromUrl(audioSource, apiKey);

      let projectName: string | undefined;
      let projectDescription: string | undefined;
      let taskTitle: string | undefined;

      if (recording.projectId) {
        const project = await Project.findById(recording.projectId).lean();
        if (project) {
          projectName = (project as { name?: string }).name;
          projectDescription = (project as { description?: string }).description;
          if (recording.taskId && (project as { tasks?: Array<{ _id?: { toString(): string }; title?: string }> }).tasks) {
            const task = (project as { tasks: Array<{ _id?: { toString(): string }; title?: string }> }).tasks.find(
              (t) => t._id?.toString() === recording.taskId?.toString()
            );
            taskTitle = task?.title;
          }
        }
      }

      const { summary } = await summarizeRecording(
        {
          transcript,
          title: recording.title,
          projectName,
          projectDescription,
          taskTitle,
        },
        { organizationId: String(ctx.organizationId), userId: session.userId }
      );

      recording.transcript = transcript;
      recording.summary = summary;
      recording.status = 'complete';
      recording.errorMessage = undefined;
      await recording.save();

      return NextResponse.json({
        id: recording._id.toString(),
        status: recording.status,
        transcript: recording.transcript,
        summary: recording.summary,
      });
    } catch (processError) {
      recording.status = 'failed';
      recording.errorMessage =
        processError instanceof Error ? processError.message : 'Processing failed.';
      await recording.save();
      return NextResponse.json(
        { error: recording.errorMessage, status: recording.status },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('POST recording process error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
