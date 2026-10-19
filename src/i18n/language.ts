import type { Language } from './translations';

const STORAGE_KEY = 'rewallet-language';
const CHANGE_EVENT = 'rewallet-language-change';

/**
 * UI language shared between the sign-in gate and the wallet app. The gate
 * mounts outside `<WalletApp>`, so the choice has to live outside React state
 * and travel through localStorage + a window event.
 */
export function getStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'es' || stored === 'en' ? stored : 'en';
  } catch {
    return 'en';
  }
}

export function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Private mode / disabled storage: the choice just will not survive a reload.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** React to language changes made by the other mount (gate ↔ app). */
export function subscribeLanguage(listener: (language: Language) => void): () => void {
  const handler = () => listener(getStoredLanguage());
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
