"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { favoritesApi, type ListFavoritesParams } from "../lib/favorites";
import type { FavoriteUpdateRequest } from "../types/api";

export const favoriteKeys = {
  all: ["favorites"] as const,
  lists: () => [...favoriteKeys.all, "list"] as const,
  list: (params?: ListFavoritesParams) => [...favoriteKeys.lists(), params] as const,
  detail: (id: string) => [...favoriteKeys.all, "detail", id] as const,
  status: (versionId: string) => [...favoriteKeys.all, "status", versionId] as const,
  tags: () => [...favoriteKeys.all, "tags"] as const,
};

export function useFavorites(params?: ListFavoritesParams) {
  return useQuery({
    queryKey: favoriteKeys.list(params),
    queryFn: () => favoritesApi.list(params),
  });
}

export function useFavorite(id: string) {
  return useQuery({
    queryKey: favoriteKeys.detail(id),
    queryFn: () => favoritesApi.get(id),
    enabled: !!id,
  });
}

export function useFavoriteStatus(promptVersionId: string | null | undefined) {
  return useQuery({
    queryKey: favoriteKeys.status(promptVersionId ?? ""),
    queryFn: () => favoritesApi.status(promptVersionId!),
    enabled: !!promptVersionId,
  });
}

export function useFavoriteTags() {
  return useQuery({
    queryKey: favoriteKeys.tags(),
    queryFn: favoritesApi.tags,
  });
}

export function useLikeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: favoritesApi.create,
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: favoriteKeys.lists() });
      qc.invalidateQueries({ queryKey: favoriteKeys.status(data.prompt_version_id) });
    },
  });
}

export function useUnlikeMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => favoritesApi.remove(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: favoriteKeys.lists() });
      qc.removeQueries({ queryKey: favoriteKeys.detail(id) });
    },
  });
}

export function useUnlikeByVersionMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (promptVersionId: string) => favoritesApi.removeByVersion(promptVersionId),
    onSuccess: (_data, promptVersionId) => {
      qc.invalidateQueries({ queryKey: favoriteKeys.lists() });
      qc.invalidateQueries({ queryKey: favoriteKeys.status(promptVersionId) });
    },
  });
}

export function useUpdateFavoriteMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & FavoriteUpdateRequest) =>
      favoritesApi.update(id, body),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: favoriteKeys.lists() });
      qc.setQueryData(favoriteKeys.detail(data.id), data);
    },
  });
}

export function useIncrementUseMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => favoritesApi.incrementUse(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: favoriteKeys.detail(id) });
      qc.invalidateQueries({ queryKey: favoriteKeys.lists() });
    },
  });
}
