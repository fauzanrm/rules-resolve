const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, (data as { detail?: string }).detail ?? "Request failed");
  }

  return data as T;
}

export async function postForm<T>(path: string, formData: FormData): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    body: formData,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, (data as { detail?: string }).detail ?? "Request failed");
  }

  return data as T;
}

export async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, (data as { detail?: string }).detail ?? "Request failed");
  }

  return data as T;
}

export async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, (data as { detail?: string }).detail ?? "Request failed");
  }

  return data as T;
}
