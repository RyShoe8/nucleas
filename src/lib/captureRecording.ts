import { isTouchMobileDevice } from '@/lib/capture/mobileCapture';

export class RecordingCaptureError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'unsupported'
      | 'permission_denied'
      | 'canceled'
      | 'capture_failed'
      | 'mic_denied'
      | 'system_audio_missing'
  ) {
    super(message);
    this.name = 'RecordingCaptureError';
  }
}

export type RecordingAudioSource = 'system' | 'mic';

type RecordingCaptureResult = {
  videoFile: File;
  audioFile: File | null;
  durationSeconds: number;
  audioIncluded: boolean;
  audioSource: RecordingAudioSource;
};

export type RecordingSession = {
  begin: () => void;
  stop: () => Promise<RecordingCaptureResult>;
  cancel: () => void;
};

export const MAX_RECORDING_SECONDS = 20 * 60;
export const STABILIZATION_SECONDS = 5;

type CaptureStartFocusBehavior = 'focus-capturing-application' | 'focus-captured-surface' | 'no-focus-change';

interface CaptureControllerLike {
  setFocusBehavior(behavior: CaptureStartFocusBehavior): void;
}

type DisplayMediaOptionsWithController = DisplayMediaStreamOptions & {
  controller?: CaptureControllerLike;
  preferCurrentTab?: boolean;
};

type AudioMixContext = {
  audioContext: AudioContext;
  destination: MediaStreamAudioDestinationNode;
};

function createCaptureController(): CaptureControllerLike | null {
  const CaptureControllerCtor = (globalThis as { CaptureController?: new () => CaptureControllerLike })
    .CaptureController;
  if (!CaptureControllerCtor) return null;
  try {
    return new CaptureControllerCtor();
  } catch {
    return null;
  }
}

function keepCapturingPageFocused(
  controller: CaptureControllerLike | null,
  stream: MediaStream
): void {
  const videoTrack = stream.getVideoTracks()[0];
  const displaySurface = videoTrack?.getSettings().displaySurface;

  if (controller && (displaySurface === 'browser' || displaySurface === 'window')) {
    try {
      controller.setFocusBehavior('focus-capturing-application');
      return;
    } catch {
      // fall through
    }
  }

  if (typeof window !== 'undefined') {
    window.focus();
  }
}

function mapCaptureError(error: unknown): RecordingCaptureError {
  if (error instanceof RecordingCaptureError) return error;

  const domError = error as DOMException;
  if (domError?.name === 'NotAllowedError') {
    return new RecordingCaptureError(
      'Permission denied. Allow screen sharing to record.',
      'permission_denied'
    );
  }
  if (domError?.name === 'AbortError') {
    return new RecordingCaptureError('Recording was canceled.', 'canceled');
  }

  return new RecordingCaptureError('Failed to start recording.', 'capture_failed');
}

function isLowEndDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const cores = navigator.hardwareConcurrency ?? 8;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (cores <= 4) return true;
  if (memory != null && memory <= 4) return true;
  return false;
}

function pickVideoMimeType(): string {
  const mp4Candidates = [
    'video/mp4;codecs="avc1.42E01E, mp4a.40.2"',
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
  ];
  for (const type of mp4Candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }

  const lowEnd = isLowEndDevice();
  const webmCandidates = lowEnd
    ? ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9,opus', 'video/webm']
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

  for (const type of webmCandidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

function recordingFileExtension(mimeType: string): string {
  if (mimeType.startsWith('video/mp4')) return 'mp4';
  return 'webm';
}

function pickAudioMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'audio/webm';
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function chunksToFile(chunks: Blob[], mimeType: string, fileName: string): File {
  const blob = new Blob(chunks, { type: mimeType });
  return new File([blob], fileName, { type: mimeType.split(';')[0] || mimeType });
}

const MIN_VIDEO_BITRATE = 2_500_000;
const MAX_VIDEO_BITRATE = 16_000_000;
const DEFAULT_VIDEO_BITRATE = 6_000_000;
const AUDIO_BITRATE = 192_000;
const RECORDER_TIMESLICE_MS = 250;

function computeVideoBitrate(width: number, height: number): number {
  const pixels = Math.max(1, width * height);
  const computed = Math.round(pixels * 0.005);
  return Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, computed || DEFAULT_VIDEO_BITRATE));
}

function createMixedAudioTrack(audioStreams: MediaStream[]): AudioMixContext | null {
  const tracks = audioStreams.flatMap((stream) => stream.getAudioTracks());
  if (tracks.length === 0) return null;

  const audioContext = new AudioContext();
  const destination = audioContext.createMediaStreamDestination();

  for (const track of tracks) {
    const sourceStream = new MediaStream([track]);
    const source = audioContext.createMediaStreamSource(sourceStream);
    source.connect(destination);
  }

  return { audioContext, destination };
}

export function isRecordingCaptureSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function' &&
    typeof MediaRecorder !== 'undefined'
  );
}

export type PrepareRecordingSessionOptions = {
  audioSource: RecordingAudioSource;
  /** Pre-acquired microphone stream from a permission preflight. */
  micStream?: MediaStream | null;
  /** Called when the user stops screen sharing before recording begins. */
  onShareEnded?: () => void;
};

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
  },
  video: false,
};

export function formatMicPermissionError(error: unknown): string {
  const domError = error as DOMException;
  if (domError?.name === 'NotAllowedError') {
    return 'Microphone is blocked for this site. Open your browser’s site settings (lock icon in the address bar) and allow Microphone for Nucleas.';
  }
  if (domError?.name === 'NotFoundError') {
    return 'No microphone detected. Connect a microphone or choose System audio instead.';
  }
  if (domError?.name === 'NotReadableError') {
    return 'Microphone is in use by another app. Close other apps using the mic or choose System audio.';
  }
  return 'Microphone access failed. Check browser site settings or choose System audio.';
}

/** Request microphone access for recording preflight. Caller must stop tracks when done. */
export async function requestMicrophoneForRecording(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new RecordingCaptureError(
      'Microphone capture is unavailable in this browser.',
      'unsupported'
    );
  }
  try {
    return await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
  } catch (error) {
    throw new RecordingCaptureError(formatMicPermissionError(error), 'mic_denied');
  }
}

async function acquireMicStream(existing?: MediaStream | null): Promise<MediaStream> {
  if (existing && existing.getAudioTracks().some((t) => t.readyState === 'live')) {
    return existing;
  }
  return requestMicrophoneForRecording();
}

/** Acquire screen share and prepare recorders. Call begin() to start capture. */
export async function prepareRecordingSession(
  options: PrepareRecordingSessionOptions
): Promise<RecordingSession> {
  const { audioSource, micStream: preflightMicStream, onShareEnded } = options;

  if (!isRecordingCaptureSupported()) {
    throw new RecordingCaptureError(
      'Recording is unavailable in this browser. Please upload a video instead.',
      'unsupported'
    );
  }

  let displayStream: MediaStream | null = null;
  let micStream: MediaStream | null = null;
  let combinedStream: MediaStream | null = null;
  let audioMixContext: AudioMixContext | null = null;
  let videoRecorder: MediaRecorder | null = null;
  let audioRecorder: MediaRecorder | null = null;
  let canceled = false;
  let hasBegun = false;
  let autoStopTimer: number | null = null;
  let startedAt = 0;

  const videoChunks: Blob[] = [];
  const audioChunks: Blob[] = [];
  let audioIncluded = false;

  const cleanup = () => {
    if (autoStopTimer != null) {
      window.clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
    stopStream(combinedStream);
    stopStream(displayStream);
    stopStream(micStream);
    combinedStream = null;
    displayStream = null;
    micStream = null;
    if (audioMixContext) {
      void audioMixContext.audioContext.close().catch(() => {});
      audioMixContext = null;
    }
  };

  try {
    if (audioSource === 'mic') {
      micStream = await acquireMicStream(preflightMicStream);
    }

    const controller = createCaptureController();
    if (controller) {
      try {
        controller.setFocusBehavior('focus-capturing-application');
      } catch {
        // unsupported before getDisplayMedia
      }
    }

    const isMobile = isTouchMobileDevice();
    const displayMediaOptions: DisplayMediaOptionsWithController = {
      video: isMobile
        ? {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 24 },
          }
        : {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
      audio: audioSource === 'system',
      preferCurrentTab: isMobile,
    };
    if (controller) {
      displayMediaOptions.controller = controller;
    }

    displayStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    keepCapturingPageFocused(controller, displayStream);

    const videoTrack = displayStream.getVideoTracks()[0];
    if (videoTrack) {
      try {
        videoTrack.contentHint = 'motion';
      } catch {
        // unsupported in some browsers
      }
    }

    const displayAudioTracks = displayStream.getAudioTracks();
    const micAudioTracks = micStream?.getAudioTracks() ?? [];

    if (audioSource === 'system') {
      audioIncluded = displayAudioTracks.length > 0;
    } else {
      audioIncluded = micAudioTracks.length > 0;
    }

    const audioSourcesForMix: MediaStream[] = [];
    if (audioSource === 'system' && displayAudioTracks.length > 0) {
      audioSourcesForMix.push(new MediaStream(displayAudioTracks));
    }
    if (audioSource === 'mic' && micStream) {
      audioSourcesForMix.push(micStream);
    }

    audioMixContext = createMixedAudioTrack(audioSourcesForMix);
    const mixedAudioTrack = audioMixContext?.destination.stream.getAudioTracks()[0] ?? null;

    const videoTracks = displayStream.getVideoTracks();
    combinedStream = new MediaStream([
      ...videoTracks,
      ...(mixedAudioTrack ? [mixedAudioTrack] : []),
    ]);

    const videoSettings = videoTracks[0]?.getSettings();
    const videoWidth = videoSettings?.width ?? 1920;
    const videoHeight = videoSettings?.height ?? 1080;
    const videoBitsPerSecond = computeVideoBitrate(videoWidth, videoHeight);

    if (process.env.NODE_ENV === 'development') {
      console.info('[recording]', {
        mimeType: pickVideoMimeType(),
        width: videoWidth,
        height: videoHeight,
        bitrate: videoBitsPerSecond,
        audioSource,
        audioIncluded,
      });
    }

    const videoMimeType = pickVideoMimeType();
    const audioMimeType = pickAudioMimeType();

    videoRecorder = new MediaRecorder(combinedStream, {
      mimeType: videoMimeType,
      videoBitsPerSecond,
      audioBitsPerSecond: mixedAudioTrack ? AUDIO_BITRATE : undefined,
    });

    videoRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) videoChunks.push(event.data);
    };

    const audioStreamForSeparateFile =
      audioSource === 'mic' && micStream
        ? micStream
        : audioSource === 'system' && displayAudioTracks.length > 0
          ? new MediaStream(displayAudioTracks)
          : null;

    if (audioStreamForSeparateFile && audioStreamForSeparateFile.getAudioTracks().length > 0) {
      audioRecorder = new MediaRecorder(audioStreamForSeparateFile, {
        mimeType: audioMimeType,
        audioBitsPerSecond: AUDIO_BITRATE,
      });
      audioRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.push(event.data);
      };
    }

    const displayTrack = displayStream.getVideoTracks()[0];
    displayTrack?.addEventListener(
      'ended',
      () => {
        if (canceled) return;
        if (videoRecorder?.state === 'recording') {
          void videoRecorder.stop();
        } else {
          canceled = true;
          cleanup();
          onShareEnded?.();
        }
      },
      { once: true }
    );

    const finalize = (): Promise<RecordingCaptureResult> =>
      new Promise((resolve, reject) => {
        let videoDone = false;
        let audioDone = !audioRecorder;

        const maybeResolve = () => {
          if (videoDone && audioDone) {
            cleanup();
            const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const extension = recordingFileExtension(videoMimeType);
            const videoFile = chunksToFile(
              videoChunks,
              videoMimeType,
              `recording-${timestamp}.${extension}`
            );
            const audioFile =
              audioChunks.length > 0
                ? chunksToFile(audioChunks, audioMimeType, `recording-audio-${timestamp}.webm`)
                : null;
            resolve({
              videoFile,
              audioFile,
              durationSeconds,
              audioIncluded,
              audioSource,
            });
          }
        };

        if (!videoRecorder) {
          reject(new RecordingCaptureError('Recorder not initialized.', 'capture_failed'));
          return;
        }

        videoRecorder.onstop = () => {
          videoDone = true;
          maybeResolve();
        };
        videoRecorder.onerror = () => {
          reject(new RecordingCaptureError('Recording failed.', 'capture_failed'));
        };

        if (audioRecorder) {
          audioRecorder.onstop = () => {
            audioDone = true;
            maybeResolve();
          };
          audioRecorder.onerror = () => {
            audioDone = true;
            maybeResolve();
          };
        }
      });

    return {
      begin: () => {
        if (canceled || hasBegun || !videoRecorder) return;
        hasBegun = true;
        startedAt = Date.now();
        videoRecorder.start(RECORDER_TIMESLICE_MS);
        audioRecorder?.start(RECORDER_TIMESLICE_MS);
        autoStopTimer = window.setTimeout(() => {
          if (videoRecorder?.state === 'recording') {
            videoRecorder.stop();
          }
        }, MAX_RECORDING_SECONDS * 1000);
      },
      stop: async () => {
        if (canceled) {
          throw new RecordingCaptureError('Recording was canceled.', 'canceled');
        }
        if (!hasBegun) {
          throw new RecordingCaptureError('Recording was not started.', 'canceled');
        }
        if (videoRecorder?.state === 'recording') {
          videoRecorder.stop();
        }
        if (audioRecorder?.state === 'recording') {
          audioRecorder.stop();
        }
        return finalize();
      },
      cancel: () => {
        canceled = true;
        if (videoRecorder?.state === 'recording') {
          try {
            videoRecorder.stop();
          } catch {
            // ignore
          }
        }
        if (audioRecorder?.state === 'recording') {
          try {
            audioRecorder.stop();
          } catch {
            // ignore
          }
        }
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    if (error instanceof RecordingCaptureError) throw error;
    throw mapCaptureError(error);
  }
}

/** Acquire camera stream and prepare a single-file recorder. Call begin() to start capture. */
export async function prepareCameraRecordingSession(options?: {
  onEnded?: () => void;
}): Promise<RecordingSession> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof MediaRecorder === 'undefined'
  ) {
    throw new RecordingCaptureError(
      'Camera recording is unavailable in this browser. Please upload a video instead.',
      'unsupported'
    );
  }

  let cameraStream: MediaStream | null = null;
  let videoRecorder: MediaRecorder | null = null;
  let canceled = false;
  let hasBegun = false;
  let autoStopTimer: number | null = null;
  let startedAt = 0;

  const videoChunks: Blob[] = [];
  let audioIncluded = false;

  const cleanup = () => {
    if (autoStopTimer != null) {
      window.clearTimeout(autoStopTimer);
      autoStopTimer = null;
    }
    stopStream(cameraStream);
    cameraStream = null;
  };

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    const videoTracks = cameraStream.getVideoTracks();
    if (videoTracks.length === 0) {
      throw new RecordingCaptureError('No camera video track available.', 'capture_failed');
    }

    audioIncluded = cameraStream.getAudioTracks().some((track) => track.readyState === 'live');

    const videoSettings = videoTracks[0]?.getSettings();
    const videoWidth = videoSettings?.width ?? 1280;
    const videoHeight = videoSettings?.height ?? 720;
    const videoBitsPerSecond = computeVideoBitrate(videoWidth, videoHeight);
    const videoMimeType = pickVideoMimeType();

    videoRecorder = new MediaRecorder(cameraStream, {
      mimeType: videoMimeType,
      videoBitsPerSecond,
      audioBitsPerSecond: audioIncluded ? AUDIO_BITRATE : undefined,
    });

    videoRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) videoChunks.push(event.data);
    };

    const videoTrack = videoTracks[0];
    videoTrack?.addEventListener(
      'ended',
      () => {
        if (canceled) return;
        if (videoRecorder?.state === 'recording') {
          void videoRecorder.stop();
        } else {
          canceled = true;
          cleanup();
          options?.onEnded?.();
        }
      },
      { once: true }
    );

    const finalize = (): Promise<RecordingCaptureResult> =>
      new Promise((resolve, reject) => {
        if (!videoRecorder) {
          reject(new RecordingCaptureError('Recorder not initialized.', 'capture_failed'));
          return;
        }

        videoRecorder.onstop = () => {
          cleanup();
          const durationSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const extension = recordingFileExtension(videoMimeType);
          const videoFile = chunksToFile(
            videoChunks,
            videoMimeType,
            `recording-${timestamp}.${extension}`
          );
          resolve({
            videoFile,
            audioFile: null,
            durationSeconds,
            audioIncluded,
            audioSource: 'mic',
          });
        };
        videoRecorder.onerror = () => {
          reject(new RecordingCaptureError('Recording failed.', 'capture_failed'));
        };
      });

    return {
      begin: () => {
        if (canceled || hasBegun || !videoRecorder) return;
        hasBegun = true;
        startedAt = Date.now();
        videoRecorder.start(RECORDER_TIMESLICE_MS);
        autoStopTimer = window.setTimeout(() => {
          if (videoRecorder?.state === 'recording') {
            videoRecorder.stop();
          }
        }, MAX_RECORDING_SECONDS * 1000);
      },
      stop: async () => {
        if (canceled) {
          throw new RecordingCaptureError('Recording was canceled.', 'canceled');
        }
        if (!hasBegun) {
          throw new RecordingCaptureError('Recording was not started.', 'canceled');
        }
        if (videoRecorder?.state === 'recording') {
          videoRecorder.stop();
        }
        return finalize();
      },
      cancel: () => {
        canceled = true;
        if (videoRecorder?.state === 'recording') {
          try {
            videoRecorder.stop();
          } catch {
            // ignore
          }
        }
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    if (error instanceof RecordingCaptureError) throw error;
    throw mapCaptureError(error);
  }
}

export function recordingAudioWarning(
  audioSource: RecordingAudioSource,
  audioIncluded: boolean
): string | null {
  if (audioIncluded) return null;
  if (audioSource === 'system') {
    return 'System audio was not shared. Enable "Share tab/system audio" in the screen picker.';
  }
  return 'Voice audio was not captured. Transcript may be limited without a microphone track.';
}
