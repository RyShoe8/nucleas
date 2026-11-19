'use client';

import { useRef, useState } from 'react';
import Button from '@/components/ui/Button';
import RecordingSaveDialog from '@/components/shared/RecordingSaveDialog';
import RecordingNameDialog from '@/components/shared/RecordingNameDialog';
import RecordingOverlay from '@/components/shared/RecordingOverlay';
import {
  isRecordingCaptureSupported,
  type RecordingAudioSource,
} from '@/lib/captureRecording';
import { getRecordingCaptureMode } from '@/lib/capture/mobileCapture';
import {
  useRecordingUpload,
  type RecordingUploadControl,
} from '@/hooks/useRecordingUpload';
import type { IProject } from '@/lib/models/Project';
import type { MediaUploadTarget } from '@/lib/mediaUploadTarget';

interface RecordingToolPanelProps {
  target?: MediaUploadTarget | null;
  projects?: IProject[];
  allowAssignment?: boolean;
  uploadOnly?: boolean;
  description?: string;
  onUploaded?: () => void;
  onPrepared?: () => void;
  onBack?: () => void;
  showBack?: boolean;
  recordingControl?: RecordingUploadControl;
  hideSaveDialog?: boolean;
}

function RecordingToolPanelInner({
  target = null,
  projects = [],
  allowAssignment = false,
  uploadOnly: uploadOnlyProp = false,
  description = 'Record your screen with system or microphone audio, or upload a video.',
  onUploaded: _onUploaded,
  onBack,
  showBack = false,
  control,
  hideSaveDialog = false,
}: RecordingToolPanelProps & { control: RecordingUploadControl }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captureMode = getRecordingCaptureMode();
  const uploadOnly = uploadOnlyProp || captureMode === 'upload-only';
  const screenCaptureSupported = isRecordingCaptureSupported();
  const cameraCaptureSupported = captureMode === 'camera';
  const useSaveDialog = allowAssignment && !target;
  const [audioSource, setAudioSource] = useState<RecordingAudioSource | null>(null);

  const {
    status,
    statusMessage,
    errorMessage,
    micWarning,
    micPermissionStatus,
    micPermissionMessage,
    requestMicPermission,
    clearMicPreflight,
    isBusy,
    isPreparing,
    isStabilizing,
    isArmed,
    isRecording,
    isConverting,
    isNaming,
    controlsInPopout,
    suggestedName,
    previewUrl,
    elapsedLabel,
    stabilizeSecondsRemaining,
    prepareRecording,
    prepareCameraRecording,
    skipStabilization,
    beginRecording,
    stopRecording,
    uploadFromFiles,
    confirmSave,
    downloadByName,
    cancelNaming,
    transcodeDebug,
  } = control;

  const showScreenSetup =
    captureMode === 'screen' &&
    screenCaptureSupported &&
    !uploadOnly &&
    !isPreparing &&
    !isStabilizing &&
    !isArmed &&
    !isRecording &&
    !isConverting;

  const showCameraSetup =
    cameraCaptureSupported &&
    !uploadOnly &&
    !isPreparing &&
    !isRecording &&
    !isConverting;

  const handleShareScreen = () => {
    if (!audioSource || isBusy) return;
    if (audioSource === 'mic' && micPermissionStatus !== 'ready') return;
    void prepareRecording(audioSource);
  };

  const handleAudioSourceChange = (source: RecordingAudioSource) => {
    setAudioSource(source);
    if (source === 'system') {
      clearMicPreflight();
    }
  };

  const shareScreenDisabled =
    isBusy || !audioSource || (audioSource === 'mic' && micPermissionStatus !== 'ready');

  return (
    <>
      {!controlsInPopout && (isStabilizing || isArmed || isRecording) && (
        <RecordingOverlay
          phase={isRecording ? 'recording' : isStabilizing ? 'stabilizing' : 'armed'}
          elapsedLabel={elapsedLabel}
          stabilizeSecondsRemaining={stabilizeSecondsRemaining}
          onStart={beginRecording}
          onStop={() => void stopRecording()}
          onSkipStabilization={skipStabilization}
        />
      )}

      <div className="space-y-3">
        {!uploadOnly && (
          <p className="text-sm text-text-secondary">
            {captureMode === 'camera'
              ? 'Record a video with your camera or upload an existing file.'
              : description}
          </p>
        )}
        {uploadOnly && (
          <p className="text-sm text-text-secondary">
            Recording capture is unavailable on this device. Upload a video instead.
          </p>
        )}

        {showScreenSetup && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-text-primary">Audio source</legend>
            <label className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="radio"
                name="recording-audio-source"
                className="mt-1"
                checked={audioSource === 'system'}
                onChange={() => handleAudioSourceChange('system')}
                disabled={isBusy}
              />
              <span>
                <span className="font-medium text-text-primary">System audio</span>
                <span className="block text-xs text-text-muted mt-0.5">
                  Captures sound from the tab or window you share. Check &quot;Share tab/system
                  audio&quot; in the browser picker.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="radio"
                name="recording-audio-source"
                className="mt-1"
                checked={audioSource === 'mic'}
                onChange={() => handleAudioSourceChange('mic')}
                disabled={isBusy}
              />
              <span>
                <span className="font-medium text-text-primary">Microphone</span>
                <span className="block text-xs text-text-muted mt-0.5">
                  Records your voice while you present. Allow microphone access before sharing your
                  screen.
                </span>
              </span>
            </label>
            {audioSource === 'mic' && (
              <div className="ml-6 space-y-2">
                {micPermissionStatus === 'ready' ? (
                  <p className="text-xs text-success">Microphone ready</p>
                ) : micPermissionStatus === 'blocked' ? (
                  <p className="text-xs text-warning">{micPermissionMessage}</p>
                ) : (
                  <p className="text-xs text-text-muted">
                    Your browser will ask for microphone permission.
                  </p>
                )}
                {micPermissionStatus !== 'ready' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={isBusy || micPermissionStatus === 'checking'}
                    onClick={() => void requestMicPermission()}
                  >
                    {micPermissionStatus === 'checking' ? 'Checking…' : 'Allow microphone'}
                  </Button>
                )}
              </div>
            )}
          </fieldset>
        )}

        {isPreparing && (
          <p className="text-xs text-text-muted">{statusMessage ?? 'Select a screen to share…'}</p>
        )}

        {isStabilizing && !controlsInPopout && (
          <p className="text-xs text-text-muted">
            {statusMessage ??
              'Wait until streaming video looks sharp, then press Ready to record or Start when the countdown finishes.'}
          </p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          className="hidden"
          disabled={isBusy}
          onChange={(e) => {
            const files = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = '';
            if (files.length > 0) void uploadFromFiles(files);
          }}
        />
        <div className="flex flex-col gap-2">
          {showScreenSetup && (
            <Button
              type="button"
              size="sm"
              onClick={handleShareScreen}
              disabled={shareScreenDisabled}
            >
              Share screen
            </Button>
          )}
          {showCameraSetup && (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                if (!isBusy) void prepareCameraRecording();
              }}
              disabled={isBusy}
            >
              Record video
            </Button>
          )}
          <Button
            type="button"
            variant={uploadOnly ? undefined : 'secondary'}
            size="sm"
            onClick={() => {
              if (!isBusy) fileInputRef.current?.click();
            }}
            disabled={isBusy}
          >
            Upload video
          </Button>
        </div>
        {isConverting && (
          <p className="text-xs text-text-muted">{statusMessage ?? 'Preparing video…'}</p>
        )}
        {statusMessage && !isBusy && !isConverting && !isPreparing && (
          <p className="text-xs text-text-muted">{statusMessage}</p>
        )}
        {errorMessage && <p className="text-xs text-error">{errorMessage}</p>}
        {showBack && onBack && (
          <Button type="button" variant="secondary" size="sm" onClick={onBack} disabled={isBusy}>
            Back
          </Button>
        )}
      </div>

      {!hideSaveDialog &&
        (useSaveDialog ? (
          <RecordingSaveDialog
            isOpen={isNaming}
            defaultName={suggestedName}
            previewUrl={previewUrl}
            projects={projects}
            micWarning={micWarning}
            transcodeDebug={transcodeDebug}
            saving={status === 'uploading'}
            processing={status === 'processing'}
            statusMessage={statusMessage}
            onSave={(name, uploadTarget) => void confirmSave(name, uploadTarget)}
            onDownload={downloadByName}
            onCancel={cancelNaming}
          />
        ) : (
          <RecordingNameDialog
            isOpen={isNaming}
            defaultName={suggestedName}
            saving={status === 'uploading'}
            processing={status === 'processing'}
            onConfirm={(name) => void confirmSave(name)}
            onCancel={cancelNaming}
          />
        ))}
    </>
  );
}

export default function RecordingToolPanel(props: RecordingToolPanelProps) {
  const internalControl = useRecordingUpload(
    props.target ?? null,
    props.onUploaded,
    props.onPrepared
  );
  const control = props.recordingControl ?? internalControl;

  return <RecordingToolPanelInner {...props} control={control} />;
}
