const TOKEN_KEY = 'nginx-ui-token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export async function login(username: string, password: string): Promise<{ token: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data.error ?? 'Login failed')
  }
  if (data.token) {
    setToken(data.token)
  }
  return data
}

export function fetchWithAuth(url: string, opts: RequestInit = {}): Promise<Response> {
  const token = getToken()
  const headers = new Headers(opts.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  return fetch(url, { ...opts, headers })
}
