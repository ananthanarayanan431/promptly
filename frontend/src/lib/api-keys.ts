import { api } from '@/lib/api';
import type { ApiKey, ApiKeyCreated, PaginatedApiKeyList } from '@/types/api';

export type ApiKeyStatus = 'all' | 'active' | 'revoked';

export async function listApiKeys(
  page = 1,
  pageSize = 20,
  status: ApiKeyStatus = 'all',
): Promise<PaginatedApiKeyList> {
  const res = await api.get<{ data: PaginatedApiKeyList }>('/api/v1/users/api-keys', {
    params: { page, page_size: pageSize, status },
  });
  return res.data.data;
}

export async function createApiKey(name: string): Promise<ApiKeyCreated> {
  const res = await api.post<{ data: ApiKeyCreated }>('/api/v1/users/api-keys', { name });
  return res.data.data;
}

export async function revokeApiKey(keyId: string): Promise<ApiKey> {
  const res = await api.delete<{ data: ApiKey }>(`/api/v1/users/api-keys/${keyId}`);
  return res.data.data;
}
