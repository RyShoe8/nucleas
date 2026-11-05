/**
 * Speech to text where the browser has no speech service, such as the desktop app (Electron has the Web Speech API
 * but nothing behind it): records the microphone until the person stops talking, then transcribes it on the server.
 */

/** Average level (0 to 1) above which a moment counts as speech. */
const SPEECH_LEVEL = 0.015;
const CHECK_EVERY_MS = 100;

export type CaptureDecision = 'continue' | 'finish' | 'nothing-heard';

/** When to stop recording: after a pause once they have spoken, at the time limit, or if they never speak. */
export function captureDecision(input: { elapsedMs: number; msSinceSpeech: number | null; silenceMs: number; noSpeechMs: number; maxMs: number }): CaptureDecision {
    if (input.msSinceSpeech === null) return input.elapsedMs >= input.noSpeechMs ? 'nothing-heard' : 'continue';
    if (input.elapsedMs >= input.maxMs) return 'finish';
    return input.msSinceSpeech >= input.silenceMs ? 'finish' : 'continue';
}

export function microphoneProblem(error: unknown): string {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'NotAllowedError') return 'Nucleas is not allowed to use the microphone. Allow it when asked, or check Windows microphone privacy settings.';
    if (name === 'NotFoundError') return 'No microphone was found. Connect one and try again.';
    if (name === 'NotReadableError') return 'Another app is using the microphone. Close it and try again.';
    return 'The microphone could not be started.';
}

export interface SpeechCapture {
    /** Stop recording and transcribe what was said so far. */
    finish(): void;
    /** Stop and discard. */
    cancel(): void;
    /** The transcript: empty when nothing was said or it was cancelled. Rejects with a message to show. */
    done: Promise<string>;
}

export function startSpeechCapture(options: { endpoint: string; silenceMs: number; maxMs: number; noSpeechMs?: number; onTranscribing?: () => void }): SpeechCapture {
    const noSpeechMs = options.noSpeechMs ?? 8000;
    let stop: (keep: boolean) => void = () => {};
    let stopRequested: boolean | null = null;

    const done = (async () => {
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('This app cannot record audio.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }).catch((error: unknown) => {
            throw new Error(microphoneProblem(error));
        });
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        context.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const chunks: Blob[] = [];
        const recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };

        const keep = await new Promise<boolean>((resolve, reject) => {
            const started = Date.now();
            let lastSpeech: number | null = null;
            let outcome = false;
            const timer = setInterval(() => {
                analyser.getFloatTimeDomainData(samples);
                const level = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
                const now = Date.now();
                if (level >= SPEECH_LEVEL) lastSpeech = now;
                const decision = captureDecision({ elapsedMs: now - started, msSinceSpeech: lastSpeech === null ? null : now - lastSpeech, silenceMs: options.silenceMs, noSpeechMs, maxMs: options.maxMs });
                if (decision !== 'continue') stop(decision === 'finish');
            }, CHECK_EVERY_MS);
            recorder.onstop = () => resolve(outcome);
            recorder.onerror = () => {
                clearInterval(timer);
                reject(new Error('The recording failed. Try again.'));
            };
            stop = (value) => {
                clearInterval(timer);
                outcome = value;
                if (recorder.state !== 'inactive') recorder.stop();
            };
            recorder.start();
            // Finish or Cancel may have been pressed while the microphone was still starting.
            if (stopRequested !== null) stop(stopRequested);
        }).finally(() => {
            stream.getTracks().forEach((track) => track.stop());
            void context.close().catch(() => {});
        });

        if (!keep || !chunks.length) return '';
        options.onTranscribing?.();
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const form = new FormData();
        form.set('file', new File([blob], blob.type.includes('mp4') ? 'speech.mp4' : 'speech.webm', { type: blob.type }));
        const response = await fetch(options.endpoint, { method: 'POST', body: form }).catch(() => {
            throw new Error('Could not reach Nucleas to transcribe that. Check your connection and try again.');
        });
        const body = (await response.json().catch(() => ({}))) as { text?: unknown; error?: unknown };
        if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Transcription failed (${response.status}).`);
        return typeof body.text === 'string' ? body.text.trim() : '';
    })();

    const request = (keep: boolean) => {
        stopRequested = keep;
        stop(keep);
    };
    return { finish: () => request(true), cancel: () => request(false), done };
}
