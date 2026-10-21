import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import fr from './locales/fr.json';

export const LANGUAGES = ['fr', 'en'] as const;
const LANG_KEY = 'bvr.lang';

// Storage can be blocked (private mode), the app then falls back to French
function storedLanguage() {
  try {
    return localStorage.getItem(LANG_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: storedLanguage() ?? 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: (typeof LANGUAGES)[number]) {
  i18n.changeLanguage(lang);
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Not persisted, still applied for this visit
  }
}

export default i18n;
