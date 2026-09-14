export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Dispute-Client": "internal-web",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body: { error?: string } = await response.json().catch(() => ({}));
    throw new Error(
      body.error || `Request failed (${response.status}). Please try again.`,
    );
  }
  return response.json() as Promise<T>;
}
