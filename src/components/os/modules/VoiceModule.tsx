'use client';

import { useVoice } from '@/components/voice/VoiceProvider';

export default function VoiceModule() {
    const voice = useVoice();

    if (!voice.enabled) {
        return (
            <div className="p-6 text-sm text-text-secondary">
                Voice is unavailable. It is limited to Administrators when the voice feature flag is enabled.
            </div>
        );
    }

    return (
        <div className="p-6 space-y-4">
            <div>
                <div className="text-xs uppercase tracking-wide text-text-secondary">State</div>
                <div className="text-sm text-text-primary mt-1">{voice.state}</div>
            </div>

            <div>
                <div className="text-xs uppercase tracking-wide text-text-secondary">Transcript</div>
                <div className="mt-1 min-h-[40px] text-sm text-text-primary bg-background-card border border-border rounded p-2 whitespace-pre-wrap">
                    {voice.transcript || <span className="text-text-muted">(none)</span>}
                </div>
            </div>

            <div className="flex items-center gap-2">
                {voice.state === 'listening' ? (
                    <button
                        type="button"
                        onClick={voice.stopListening}
                        className="px-3 h-9 rounded bg-red-600 hover:bg-red-500 text-sm text-white"
                    >
                        Stop listening
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={voice.startListening}
                        className="ui-button-primary"
                    >
                        Start listening
                    </button>
                )}
            </div>

            {voice.error && (
                <div className="text-xs text-red-400">{voice.error}</div>
            )}
            {voice.resultMessage && (
                <div className="text-xs text-emerald-400">{voice.resultMessage}</div>
            )}
        </div>
    );
}
