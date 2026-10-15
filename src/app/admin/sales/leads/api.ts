// One JSON call to an /api/admin/sales route from a client component. A lost
// session sends the admin to the login page; any other failure comes back as
// {error} with the route's own message.
export async function send<T>(url: string, method: string, body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, error: "Network error. Check your connection and try again.", data: {} };
  if (res.status === 401) {
    window.location.href = "/admin/login";
    return { ok: false, error: "Signed out", data: {} };
  }
  const data = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, data: data as T } : { ok: false, error: data.error || `Failed (${res.status})`, data };
}
