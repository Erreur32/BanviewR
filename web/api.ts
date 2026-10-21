import type { ApiErrorCode, ApiErrorResult, ApiResponse } from '../shared/api.ts';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isApiError(result: unknown): result is ApiErrorResult {
  return typeof result === 'object' && result !== null && (result as { ok?: unknown }).ok === false;
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const { result } = (await res.json()) as ApiResponse<T | ApiErrorResult>;
  if (isApiError(result)) throw new ApiError(result.code, result.error);
  return result;
}
