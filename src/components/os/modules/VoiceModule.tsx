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
            <h2 className="text-xl font-semibold">Talk to Nucleas</h2>
            <p className="text-sm text-text-secondary">Open workspaces, ask about your companies, or describe work for your team. Review the transcript before sending; you can edit requests.</p>
            <details className="text-sm"><summary className="cursor-pointer">Things you can say</summary><ul className="mt-2 list-disc pl-5 space-y-2"><li>Open analytics for Hearth over the last 28 days.</li><li>Show me all jobs.</li><li>Open the screen recorder.</li><li>Improve our casino reviews until they meet our quality standard.</li></ul><p className="mt-3 text-text-secondary">Questions and work requests use your Ask settings. Opening a capture tool does not start recording.</p></details>
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
                        Finish speaking
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={voice.startListening}
                        disabled={voice.state !== 'idle'}
                        className="ui-button-primary"
                    >
                        Start listening
                    </button>
                )}
            </div>
            {voice.state === 'listening' && <button className="ui-button" onClick={voice.cancelListening}>Cancel listening</button>}

            {voice.error && (
                <div className="text-xs text-red-400">{voice.error}</div>
            )}
            {voice.resultMessage && (
                <div className="text-xs text-emerald-400">{voice.resultMessage}</div>
            )}
        </div>
    );
}
