import OpenAI from 'openai';
import { toFile } from 'openai/uploads';

async function transcribeAudioBuffer(
  buffer: Buffer,
  filename: string,
  apiKey: string
): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const file = await toFile(buffer, filename, {
    type: filename.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm',
  });

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'whisper-1',
    response_format: 'text',
  });

  return typeof result === 'string' ? result.trim() : String(result).trim();
}

/** A short voice command from the microphone (see api/voice/stt). */
export function transcribeSpeech(buffer: Buffer, contentType: string, apiKey: string): Promise<string> {
  return transcribeAudioBuffer(buffer, contentType.includes('mp4') ? 'speech.mp4' : 'speech.webm', apiKey);
}

export async function transcribeAudioFromUrl(
  audioUrl: string,
  apiKey: string
): Promise<string> {
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error('Failed to fetch audio for transcription.');
  }
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filename = audioUrl.includes('.mp4') || audioUrl.includes('.m4a')
    ? 'recording-audio.mp4'
    : 'recording-audio.webm';
  return transcribeAudioBuffer(buffer, filename, apiKey);
}
