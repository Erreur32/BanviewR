import type { TFunction } from 'i18next';
import { ApiError } from './api.ts';

// Translated text for an API error code, the server message as fallback
// The generic CONFLICT text does not say what to change
export function conflictText(t: TFunction, err: unknown, key: string) {
  return err instanceof ApiError && err.code === 'CONFLICT' ? t(key) : errorText(t, err);
}

export function errorText(t: TFunction, err: unknown) {
  if (err instanceof ApiError) return t(`errors.${err.code}`, { defaultValue: err.message });
  return t('errors.INTERNAL');
}
