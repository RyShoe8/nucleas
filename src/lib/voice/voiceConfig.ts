/**
 * Voice configuration: provider selection, feature flags, privacy settings.
 */

import { getSpeechRecognitionConstructor } from '@/lib/voice/speechRecognitionTypes';

/** HAL-like TTS defaults (calm, measured, lower pitch) */
export const HAL_TTS_RATE = 0.9;
export const HAL_TTS_PITCH = 0.85;

export interface VoiceConfig {
    /** STT strategy: 'webSpeech' | 'hybrid' | 'server' */
    sttStrategy: 'webSpeech' | 'hybrid' | 'server';
    /** TTS enabled */
    ttsEnabled: boolean;
    /** TTS speech rate (0.8–2). When ttsVoicePreference is 'hal', defaults to HAL_TTS_RATE. */
    ttsRate?: number;
    /** TTS pitch (0.5–2). When ttsVoicePreference is 'hal', defaults to HAL_TTS_PITCH. */
    ttsPitch?: number;
    /** When 'hal', use HAL-like rate/pitch and prefer a deep male English voice. */
    ttsVoicePreference?: 'default' | 'hal';
    /** Whether to store transcripts */
    storeTranscripts: boolean;
    /** Max recording duration in seconds */
    maxRecordingDuration: number;
    /** Server STT endpoint (for hybrid/server mode) */
    serverSttEndpoint: string;
    /** Ms of silence after last final segment before finalizing (continuous recognition). */
    endOfUtteranceMs: number;
    /** Optional wake-word phrase for passive arming mode. */
    wakeWord?: string;
    /** Cooldown between wake detections to reduce false triggers. */
    wakeWordCooldownMs?: number;
    /** Accepted aliases/transcriptions for wake phrase. */
    wakeWordAliases?: string[];
    /** Minimum fuzzy match score [0..1] for wake acceptance. */
    wakeMinMatchScore?: number;
}

export function getVoiceConfig(): VoiceConfig {
    const preference: 'default' | 'hal' = 'hal';
    return {
        sttStrategy: 'hybrid', // Option B
        ttsEnabled: true,
        ttsRate: preference === 'hal' ? HAL_TTS_RATE : undefined,
        ttsPitch: preference === 'hal' ? HAL_TTS_PITCH : undefined,
        ttsVoicePreference: preference,
        storeTranscripts: false,
        maxRecordingDuration: 30,
        serverSttEndpoint: '/api/voice/stt',
        endOfUtteranceMs: 1400,
        wakeWord: 'nucleas',
        wakeWordCooldownMs: 7000,
        wakeWordAliases: ['nucleas', 'nucleus', 'nuclease', 'new cleus', 'newkleeus'],
        wakeMinMatchScore: 0.72,
    };
}

/** Actions that require explicit voice confirmation before executing */
const HIGH_RISK_ACTIONS = new Set([
    'DELETE_ENTITY',
    'EDIT_ENTITY', // Status changes, unassign
]);

/**
 * Whether speech goes through the server. Electron has the Web Speech API but no service behind it, so it
 * always fails there; some browsers do not have it at all.
 */
export function usesServerSpeech(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean(window.nucleasDesktop) || !isWebSpeechAvailable();
}

/** Check if Web Speech API is available */
export function isWebSpeechAvailable(): boolean {
    if (typeof window === 'undefined') return false;
    return !!getSpeechRecognitionConstructor();
}
