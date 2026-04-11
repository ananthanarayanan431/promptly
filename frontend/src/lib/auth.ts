export async function setToken(token: string) {
  await fetch('/api/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
}

export async function clearToken() {
  await fetch('/api/auth', { method: 'DELETE' });
}

export async function getToken(): Promise<string | null> {
  const res = await fetch('/api/auth');
  const data = await res.json();
  return data.token;
}
