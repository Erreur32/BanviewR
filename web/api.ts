import type { ApiResponse } from '../shared/api.ts';

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as ApiResponse<T>;
  return body.result;
}
