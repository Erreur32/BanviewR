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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new ApiError('INTERNAL', `HTTP ${res.status}`);
  const { result } = (await res.json()) as ApiResponse<T | ApiErrorResult>;
  if (isApiError(result)) throw new ApiError(result.code, result.error);
  return result;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string) => request<T>('DELETE', path),
};
