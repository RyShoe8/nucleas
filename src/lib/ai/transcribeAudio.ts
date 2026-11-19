import 'server-only';

/** OpenAI's speech-to-text endpoint, called directly: the model engine handles text, not audio. */
async function transcribeAudioBuffer(
  buffer: Buffer,
  filename: string,
  apiKey: string
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: filename.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm' }), filename);
  form.append('model', 'whisper-1');
  form.append('response_format', 'text');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`Transcription failed (HTTP ${response.status}).`);
  return (await response.text()).trim();
}

/** A short voice command from the microphone (see api/voice/stt). */
export function transcribeSpeech(buffer: Buffer, contentType: string, apiKey: string): Promise<string> {
  return transcribeAudioBuffer(buffer, contentType.includes('mp4') ? 'speech.mp4' : 'speech.webm', apiKey);
}

export async function transcribeAudioFromUrl(
  audioUrl: string,
  apiKey: string
): Promise<string> {
  // The caller has already checked the URL is our own storage; a redirect elsewhere is refused.
  const response = await fetch(audioUrl, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
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
