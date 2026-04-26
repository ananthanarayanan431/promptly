import { api } from '@/lib/api';
import type { ApiKey, ApiKeyCreated } from '@/types/api';

export async function listApiKeys(): Promise<ApiKey[]> {
  const res = await api.get<{ data: { keys: ApiKey[] } }>('/api/v1/users/api-keys');
  return res.data.data.keys;
}

export async function createApiKey(name: string): Promise<ApiKeyCreated> {
  const res = await api.post<{ data: ApiKeyCreated }>('/api/v1/users/api-keys', { name });
  return res.data.data;
}

export async function revokeApiKey(keyId: string): Promise<ApiKey> {
  const res = await api.delete<{ data: ApiKey }>(`/api/v1/users/api-keys/${keyId}`);
  return res.data.data;
}
