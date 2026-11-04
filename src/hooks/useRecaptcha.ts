'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getRecaptchaSiteKey,
  RECAPTCHA_FAILED_EVENT,
  RECAPTCHA_LOAD_ERROR_MESSAGE,
  RECAPTCHA_LOADED_EVENT,
} from '@/components/recaptcha/RecaptchaScript';
import type { RecaptchaAction } from '@/lib/recaptcha/actions';

const RECAPTCHA_WAIT_MS = 10_000;
const RECAPTCHA_POLL_MS = 100;

function grecaptchaReady(): boolean {
  return typeof window !== 'undefined' && Boolean(window.grecaptcha);
}

function isRecaptchaReady(): boolean {
  if (!getRecaptchaSiteKey()) return true;
  return grecaptchaReady();
}

function waitForGrecaptcha(timeoutMs = RECAPTCHA_WAIT_MS): Promise<void> {
  if (grecaptchaReady()) return Promise.resolve();
  if (typeof window === 'undefined') {
    return Promise.reject(new Error(RECAPTCHA_LOAD_ERROR_MESSAGE));
  }

  return new Promise((resolve, reject) => {
    const started = Date.now();
    let timer: number | undefined;

    const cleanup = () => {
      window.removeEventListener(RECAPTCHA_LOADED_EVENT, onLoaded);
      window.removeEventListener(RECAPTCHA_FAILED_EVENT, onFailed);
      if (timer != null) window.clearTimeout(timer);
    };

    const onLoaded = () => {
      cleanup();
      if (grecaptchaReady()) resolve();
      else reject(new Error(RECAPTCHA_LOAD_ERROR_MESSAGE));
    };

    const onFailed = () => {
      cleanup();
      reject(new Error(RECAPTCHA_LOAD_ERROR_MESSAGE));
    };

    const poll = () => {
      if (grecaptchaReady()) {
        cleanup();
        resolve();
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        cleanup();
        reject(new Error(RECAPTCHA_LOAD_ERROR_MESSAGE));
        return;
      }
      timer = window.setTimeout(poll, RECAPTCHA_POLL_MS);
    };

    timer = window.setTimeout(poll, RECAPTCHA_POLL_MS);
    window.addEventListener(RECAPTCHA_LOADED_EVENT, onLoaded);
    window.addEventListener(RECAPTCHA_FAILED_EVENT, onFailed);
  });
}

export function useRecaptcha() {
  const isEnabled = Boolean(getRecaptchaSiteKey());
  const [loadedReady, setLoadedReady] = useState(() => isRecaptchaReady());
  const [loadError, setLoadError] = useState<string | null>(null);
  const ready = !isEnabled || loadedReady;

  useEffect(() => {
    if (!isEnabled) return;

    let settled = false;

    const cleanup = () => {
      window.removeEventListener(RECAPTCHA_LOADED_EVENT, onLoaded);
      window.removeEventListener(RECAPTCHA_FAILED_EVENT, onFailed);
      window.clearInterval(pollTimer);
      window.clearTimeout(timeoutTimer);
    };

    const markReady = () => {
      if (settled || !grecaptchaReady()) return;
      settled = true;
      setLoadedReady(true);
      setLoadError(null);
      cleanup();
    };

    const markFailed = () => {
      if (settled) return;
      settled = true;
      setLoadedReady(false);
      setLoadError(RECAPTCHA_LOAD_ERROR_MESSAGE);
      cleanup();
    };

    const onLoaded = () => markReady();
    const onFailed = () => markFailed();

    window.addEventListener(RECAPTCHA_LOADED_EVENT, onLoaded);
    window.addEventListener(RECAPTCHA_FAILED_EVENT, onFailed);

    const pollTimer = window.setInterval(() => {
      markReady();
    }, RECAPTCHA_POLL_MS);

    const timeoutTimer = window.setTimeout(() => {
      if (!grecaptchaReady()) markFailed();
    }, RECAPTCHA_WAIT_MS);

    // The script can finish between the initial render and this effect.
    // Update React state too; returning early leaves the login button disabled forever.
    markReady();

    return () => {
      settled = true;
      cleanup();
    };
  }, [isEnabled]);

  const executeRecaptcha = useCallback(async (action: RecaptchaAction): Promise<string | null> => {
    const siteKey = getRecaptchaSiteKey();
    if (!siteKey) return null;

    await waitForGrecaptcha();

    return new Promise((resolve, reject) => {
      window.grecaptcha!.ready(() => {
        window
          .grecaptcha!.execute(siteKey, { action })
          .then(resolve)
          .catch(reject);
      });
    });
  }, []);

  return { executeRecaptcha, isEnabled, ready, loadError };
}
