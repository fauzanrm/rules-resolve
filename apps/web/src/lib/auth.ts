export type Role = "admin" | "user";

export interface Session {
  role: Role;
  username: string;
}

const SESSION_KEY = "rr_session";

export function setSession(role: Role, username: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SESSION_KEY, JSON.stringify({ role, username }));
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(SESSION_KEY);
}

export function getRoleRoute(role: Role): string {
  return role === "admin" ? "/admin" : "/under-construction";
}
