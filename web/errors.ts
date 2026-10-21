import type { TFunction } from 'i18next';
import { ApiError } from './api.ts';

// Translated text for an API error code, the server message as fallback
export function errorText(t: TFunction, err: unknown) {
  if (err instanceof ApiError) return t(`errors.${err.code}`, { defaultValue: err.message });
  return t('errors.INTERNAL');
}
