'use client';

import { useVoice } from '@/components/voice/VoiceProvider';
import VoiceIntentConfirmModal from '@/components/voice/VoiceIntentConfirmModal';
import { useIntentConfirmation } from '@/components/intent/IntentConfirmationContext';

export function VoiceButton({ inline = false }: { inline?: boolean }) {
    const voice = useVoice();
    if (!voice.enabled) return null;

    return (
        <button
            type="button"
            onClick={voice.state === 'listening' ? voice.stopListening : voice.startListening}
            disabled={voice.state === 'processing' || voice.state === 'confirming'}
            className={`${inline ? 'inline-flex h-11 w-11 sm:h-8 sm:w-8 shrink-0 self-end rounded-md' : 'hidden md:flex fixed bottom-20 md:bottom-6 right-6 z-[90] p-4 rounded-full shadow-2xl scale-110'} transition-colors items-center justify-center ${voice.state === 'listening'
                ? 'bg-red-500 text-white animate-pulse ring-4 ring-red-500/20'
                : voice.state === 'processing'
                    ? 'bg-yellow-500 text-white'
                    : voice.state === 'confirming'
                        ? 'bg-amber-600 text-white ring-4 ring-amber-500/25'
                        : 'bg-primary text-white hover:bg-primary-hover'
                }`}
            aria-label={voice.state === 'listening' ? 'Finish speaking' : 'Talk to Nucleas'}
            data-tour="voice-button"
            title="Ask a question, open a workspace, or describe work"
        >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
                />
            </svg>
            {!inline && voice.state === 'listening' && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 rounded-full animate-ping" />
            )}
        </button>
    );
}

export function InlineVoiceControls() {
    const voice = useVoice();
    if (!voice.enabled) return null;
    // Sits in the message row beside the attach button, not on a row of its own.
    return <div className="flex shrink-0 items-end gap-1 self-end">
        <VoiceButton inline />
        {voice.wakeWordSupported && <button type="button" onClick={voice.toggleWakeWord} aria-pressed={voice.wakeWordEnabled}
            className="hidden sm:block h-8 whitespace-nowrap rounded border border-border px-2 text-[11px] text-text-secondary hover:text-text-primary" title="Say Nucleas to activate voice">
            Wake: {voice.wakeWordEnabled ? (voice.isWakeArmed ? 'armed' : 'on') : 'off'}
        </button>}
    </div>;
}

/** controls: the floating microphone and wake-word buttons. Windows that are not the place to talk leave them out; confirmations and the listening panel still work. */
export default function VoiceOverlay({ controls = true }: { controls?: boolean } = {}) {
    const intentCtx = useIntentConfirmation();
    const voice = useVoice();

    const handleModalConfirm = async () => {
        const pendingBefore = intentCtx.pending;
        const origin = pendingBefore?.origin;
        if (origin === 'voice') {
            await voice.confirmAction();
        } else {
            await intentCtx.confirm();
        }
    };

    const handleModalCancel = () => {
        const origin = intentCtx.pending?.origin;
        intentCtx.cancel();
        if (origin === 'voice') {
            voice.resetAfterExternalIntentCancel();
        }
    };

    return (
        <>
            <VoiceIntentConfirmModal
                open={!!intentCtx.pending}
                pending={intentCtx.pending}
                onConfirm={handleModalConfirm}
                onCancel={handleModalCancel}
                onPatchSlots={intentCtx.patchPendingSlots}
            />
            {controls ? <VoiceButton /> : null}
            {controls && voice.enabled && voice.wakeWordSupported && (
                <button
                    type="button"
                    onClick={voice.toggleWakeWord}
                    className={`hidden md:block fixed bottom-36 md:bottom-24 right-6 z-[90] px-3 py-1.5 rounded-full text-xs border ${
                        voice.wakeWordEnabled
                            ? 'bg-emerald-900/80 text-emerald-200 border-emerald-600'
                            : 'bg-gray-900/80 text-gray-300 border-gray-700'
                    }`}
                    title="Toggle wake word mode (say Nucleas)"
                >
                    Wake: {voice.wakeWordEnabled ? (voice.isWakeArmed ? 'armed' : 'on') : 'off'}
                </button>
            )}
            {voice.enabled &&
                (voice.state === 'listening' || voice.state === 'processing' || voice.error || voice.resultMessage) && (
                    <div
                        className="fixed bottom-[max(6rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-[100] w-[calc(100%_-_1rem)] max-w-md max-h-[50dvh] overflow-y-auto break-words"
                        role="status"
                        aria-live="polite"
                    >
                        <div className="bg-gray-900/95 border border-gray-700 rounded-xl shadow-2xl px-5 py-4 backdrop-blur-sm">
                            {voice.state === 'listening' && (
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1 items-end h-5">
                                        {[1, 2, 3, 4, 5].map((i) => (
                                            <div
                                                key={i}
                                                className="w-1 bg-red-400 rounded-full animate-pulse"
                                                style={{
                                                    height: `${[10, 16, 20, 14, 9][i - 1]}px`,
                                                    animationDelay: `${i * 100}ms`,
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <div className="flex-1">
                                        <p className="text-white text-sm font-medium">Listening...</p>
                                        {voice.transcript && (
                                            <p className="text-gray-400 text-sm mt-1 italic">&ldquo;{voice.transcript}&rdquo;</p>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-1"><button onClick={voice.stopListening} className="min-h-11 px-2 text-white text-sm">Finish</button><button onClick={voice.cancelListening} className="min-h-11 px-2 text-gray-300 hover:text-white text-xs">Cancel</button></div>
                                </div>
                            )}

                            {voice.state === 'processing' && (
                                <div className="flex items-center gap-3">
                                    <div className="w-5 h-5 border-2 border-yellow-400/30 border-t-yellow-400 rounded-full animate-spin" />
                                    <p className="flex-1 text-yellow-400 text-sm">Processing: &ldquo;{voice.transcript}&rdquo;</p>
                                    <button type="button" className="min-h-11 px-2 text-sm text-white" onClick={voice.cancelListening}>Cancel</button>
                                </div>
                            )}

                            {voice.state === 'confirming' && voice.pendingActionDescription && (
                                <div>
                                    <p className="text-orange-400 text-sm font-medium">
                                        Confirm in the dialog: {voice.pendingActionDescription}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={voice.cancelAction}
                                        className="mt-2 text-xs text-gray-500 hover:text-white"
                                    >
                                        Cancel voice action
                                    </button>
                                </div>
                            )}

                            {voice.state === 'idle' && voice.error && (
                                <div className="flex items-center gap-2">
                                    <span className="text-red-400">❌</span>
                                    <p className="text-red-400 text-sm">{voice.error}</p>
                                </div>
                            )}

                            {voice.state === 'idle' && voice.resultMessage && !voice.error && (
                                <div className="flex items-center gap-2">
                                    <span className="text-green-400">✅</span>
                                    <p className="text-green-400 text-sm">{voice.resultMessage}</p>
                                </div>
                            )}

                            {voice.state === 'idle' && voice.wakeWordEnabled && (
                                <div className="text-[11px] text-gray-500 mt-2 space-y-0.5">
                                    <p>Wake word mode is {voice.isWakeArmed ? 'armed' : 'enabled'} (say &ldquo;Nucleas&rdquo;).</p>
                                    <p>
                                        detections:{' '}
                                        <span className="text-gray-400">{voice.wakeDetections}</span> · activations:{' '}
                                        <span className="text-gray-400">{voice.wakeActivations}</span> · cancels:{' '}
                                        <span className="text-gray-400">{voice.wakeUserCancels}</span>
                                    </p>
                                    {voice.wakeLastAlias && (
                                        <p>
                                            last alias:{' '}
                                            <span className="text-gray-400">{voice.wakeLastAlias}</span> · score:{' '}
                                            <span className="text-gray-400">{voice.wakeLastScore.toFixed(2)}</span>
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
        </>
    );
}
