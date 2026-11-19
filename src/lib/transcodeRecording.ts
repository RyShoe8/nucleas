export type TranscodeProgress = {
  ratio: number;
  message: string;
};

export type TranscodeResult = {
  file: File;
  usedFallback: boolean;
  failureStage?: 'load' | 'exec' | 'read';
  failureReason?: string;
};

type FfmpegInstance = {
  load: (config: {
    coreURL: string;
    wasmURL: string;
    classWorkerURL?: string;
  }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  on: (
    event: 'progress' | 'log',
    callback: (data: { progress?: number; message?: string }) => void
  ) => void;
};

const LOAD_TIMEOUT_MS = 30_000;
const EXEC_TIMEOUT_MS = 180_000;
const AUDIO_EXEC_TIMEOUT_MS = 30_000;

let ffmpegLoadPromise: Promise<FfmpegInstance | null> | null = null;
let lastFfmpegLog = '';

function resetFfmpegLoadCache(): void {
  ffmpegLoadPromise = null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function execTimeoutMs(file: File): number {
  const mb = file.size / (1024 * 1024);
  return Math.min(EXEC_TIMEOUT_MS, Math.max(60_000, Math.round(mb * 20_000)));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function loadFfmpeg(onProgress?: (message: string) => void): Promise<FfmpegInstance | null> {
  if (typeof window === 'undefined') return null;

  if (!ffmpegLoadPromise) {
    ffmpegLoadPromise = (async () => {
      try {
        onProgress?.('Preparing video…');
        const base = `${window.location.origin}/ffmpeg`;
        // Loaded at runtime from the copy served in public/ffmpeg: its worker is created from a URL the
        // bundler cannot follow, so bundling @ffmpeg/ffmpeg breaks the production build.
        const { FFmpeg } = (await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ `${base}/index.js`)) as typeof import('@ffmpeg/ffmpeg');
        const { toBlobURL } = await import('@ffmpeg/util');

        const ffmpeg = new FFmpeg();
        ffmpeg.on('log', ({ message }) => {
          if (message) lastFfmpegLog = message;
        });

        await withTimeout(
          ffmpeg.load({
            coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
            classWorkerURL: `${base}/worker.js`,
          }),
          LOAD_TIMEOUT_MS,
          'ffmpeg load'
        );
        return ffmpeg as unknown as FfmpegInstance;
      } catch (error) {
        resetFfmpegLoadCache();
        if (process.env.NODE_ENV === 'development') {
          console.warn('[transcodeRecording] ffmpeg.wasm failed to load', error);
        }
        return null;
      }
    })();
  }

  return ffmpegLoadPromise;
}

/** Warm ffmpeg.wasm during capture so stop-time conversion starts faster. */
export function preloadFfmpeg(): void {
  if (typeof window === 'undefined') return;
  void loadFfmpeg();
}

export function isAlreadyMp4(file: File): boolean {
  return file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
}

export function transcodeFallbackWarning(result: TranscodeResult): string {
  const playbackNote =
    'It will play in Chrome and Edge; for Windows Media Player, try downloading again or contact support if this keeps happening.';

  switch (result.failureStage) {
    case 'load':
      return `MP4 converter failed to load — your file was saved as WebM. ${playbackNote}`;
    case 'read':
      return `MP4 conversion finished but output could not be read — your file was saved as WebM. ${playbackNote}`;
    case 'exec':
      if (result.failureReason?.includes('timed out')) {
        return `MP4 conversion timed out — your file was saved as WebM. ${playbackNote}`;
      }
      return `MP4 conversion failed — your file was saved as WebM. ${playbackNote}`;
    default:
      return `MP4 conversion failed — your file was saved as WebM. ${playbackNote}`;
  }
}

export function transcodeDebugInfo(result: TranscodeResult): string {
  return JSON.stringify(
    {
      usedFallback: result.usedFallback,
      failureStage: result.failureStage ?? null,
      failureReason: result.failureReason ?? null,
      lastFfmpegLog: lastFfmpegLog || null,
    },
    null,
    2
  );
}

function webmInputName(file: File): string {
  return file.name.endsWith('.webm') ? file.name : 'input.webm';
}

type TranscodeExecOptions = {
  includeAudio: boolean;
  scaleFilter?: string;
};

async function runTranscodeExec(
  ffmpeg: FfmpegInstance,
  inputName: string,
  outputName: string,
  options: TranscodeExecOptions,
  timeoutMs: number
): Promise<void> {
  const args = ['-f', 'webm', '-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20'];

  if (options.scaleFilter) {
    args.push('-vf', options.scaleFilter);
  }

  args.push('-pix_fmt', 'yuv420p', '-fps_mode', 'cfr', '-r', '30');

  if (options.includeAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  } else {
    args.push('-an');
  }

  args.push('-movflags', '+faststart', outputName);
  await withTimeout(ffmpeg.exec(args), timeoutMs, 'ffmpeg exec');
}

function webmFallback(
  webmFile: File,
  failureStage: TranscodeResult['failureStage'],
  failureReason: string,
  onProgress?: (progress: TranscodeProgress) => void
): TranscodeResult {
  onProgress?.({
    ratio: 1,
    message: 'Saving as WebM (conversion unavailable)…',
  });
  return { file: webmFile, usedFallback: true, failureStage, failureReason };
}

/**
 * Transcode a WebM recording to MP4 (H.264 + AAC) for broad desktop player support.
 * Falls back to the original file when WASM transcode is unavailable.
 */
export async function transcodeRecordingToMp4(
  webmFile: File,
  onProgress?: (progress: TranscodeProgress) => void
): Promise<TranscodeResult> {
  onProgress?.({ ratio: 0.05, message: 'Preparing video…' });

  const ffmpeg = await loadFfmpeg((message) => {
    onProgress?.({ ratio: 0.05, message });
  });

  if (!ffmpeg) {
    return webmFallback(webmFile, 'load', 'ffmpeg.wasm failed to load', onProgress);
  }

  const inputName = webmInputName(webmFile);
  const outputName = inputName.replace(/\.webm$/i, '.mp4');
  const execTimeout = execTimeoutMs(webmFile);

  onProgress?.({ ratio: 0.1, message: 'Converting to MP4…' });

  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(webmFile));

    ffmpeg.on('progress', ({ progress }) => {
      const ratio = Number.isFinite(progress) ? Math.min(0.95, Math.max(0.1, progress ?? 0.5)) : 0.5;
      onProgress?.({ ratio, message: 'Converting to MP4…' });
    });

    const attempts: TranscodeExecOptions[] = [
      { includeAudio: true },
      { includeAudio: false },
      { includeAudio: false, scaleFilter: 'scale=-2:720' },
    ];

    let lastError: unknown = null;
    for (let i = 0; i < attempts.length; i += 1) {
      try {
        await runTranscodeExec(ffmpeg, inputName, outputName, attempts[i], execTimeout);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        try {
          await ffmpeg.deleteFile(outputName);
        } catch {
          // ignore partial output cleanup
        }
        if (i === attempts.length - 1) {
          throw error;
        }
      }
    }

    if (lastError) {
      throw lastError;
    }

    let data: Uint8Array | string;
    try {
      data = await withTimeout(ffmpeg.readFile(outputName), 15_000, 'ffmpeg readFile');
    } catch (error) {
      return webmFallback(webmFile, 'read', errorMessage(error), onProgress);
    }

    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));

    onProgress?.({ ratio: 1, message: 'Video ready' });

    const mp4File = new File([bytes as BlobPart], outputName, { type: 'video/mp4' });
    return { file: mp4File, usedFallback: false };
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('[transcodeRecording] transcode failed', error);
    }
    return webmFallback(webmFile, 'exec', errorMessage(error), onProgress);
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function transcodeAudioToMp4(webmFile: File): Promise<File | null> {
  const ffmpeg = await loadFfmpeg();
  if (!ffmpeg) return null;

  const inputName = webmFile.name.endsWith('.webm') ? webmFile.name : 'input-audio.webm';
  const outputName = inputName.replace(/\.webm$/i, '.m4a');

  try {
    const { fetchFile } = await import('@ffmpeg/util');
    await ffmpeg.writeFile(inputName, await fetchFile(webmFile));
    await withTimeout(
      ffmpeg.exec(['-i', inputName, '-c:a', 'aac', '-b:a', '192k', outputName]),
      AUDIO_EXEC_TIMEOUT_MS,
      'ffmpeg audio exec'
    );
    const data = await withTimeout(ffmpeg.readFile(outputName), 15_000, 'ffmpeg audio readFile');
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    return new File([bytes as BlobPart], outputName, { type: 'audio/mp4' });
  } catch {
    return null;
  } finally {
    try {
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch {
      // ignore
    }
  }
}
