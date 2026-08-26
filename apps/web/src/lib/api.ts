export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  /*
   * Only declare a JSON body when there is one. `DELETE` sends none, and
   * Fastify rejects `content-type: application/json` with an empty body outright
   * — FST_ERR_CTP_EMPTY_JSON_BODY, a 400 before the route ever runs. That is why
   * every delete button in the app silently did nothing.
   */
  const headers = {
    ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...init?.headers,
  };

  const response = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(response.status, body?.message ?? `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
