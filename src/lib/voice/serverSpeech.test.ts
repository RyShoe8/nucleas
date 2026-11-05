import { describe, expect, it } from 'vitest';
import { captureDecision, microphoneProblem } from './serverSpeech';

const limits = { silenceMs: 1400, noSpeechMs: 8000, maxMs: 30000 };

describe('when to stop recording speech', () => {
  it('waits for them to start, and gives up if they never do', () => {
    expect(captureDecision({ ...limits, elapsedMs: 3000, msSinceSpeech: null })).toBe('continue');
    expect(captureDecision({ ...limits, elapsedMs: 8000, msSinceSpeech: null })).toBe('nothing-heard');
  });

  it('keeps going through short pauses and finishes after a longer one', () => {
    expect(captureDecision({ ...limits, elapsedMs: 5000, msSinceSpeech: 600 })).toBe('continue');
    expect(captureDecision({ ...limits, elapsedMs: 5000, msSinceSpeech: 1400 })).toBe('finish');
  });

  it('never records past the time limit, even while they are talking', () => {
    expect(captureDecision({ ...limits, elapsedMs: 30000, msSinceSpeech: 0 })).toBe('finish');
  });
});

describe('microphone problems', () => {
  it('says what to do about each one', () => {
    expect(microphoneProblem({ name: 'NotAllowedError' })).toContain('not allowed');
    expect(microphoneProblem({ name: 'NotFoundError' })).toContain('No microphone');
    expect(microphoneProblem({ name: 'NotReadableError' })).toContain('Another app');
    expect(microphoneProblem(null)).toContain('could not be started');
  });
});
