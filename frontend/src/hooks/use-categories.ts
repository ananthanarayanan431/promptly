'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface Category {
  slug: string;
  name: string;
  description: string;
  is_predefined: boolean;
  created_at?: string | null;
}

interface CategoryListResponse {
  categories: Category[];
}

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const res = await api.get<{ data: CategoryListResponse }>('/api/v1/categories');
      return res.data.data.categories;
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; description: string }) => {
      const res = await api.post<{ data: { category: Category } }>(
        '/api/v1/categories',
        input
      );
      return res.data.data.category;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useDeleteCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slug: string) => {
      await api.delete(`/api/v1/categories/${slug}`);
      return slug;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}
