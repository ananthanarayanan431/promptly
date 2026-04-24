"use client";

import { api } from "./api";
import type {
  FavoriteCategory,
  FavoriteCreateRequest,
  FavoriteListResponse,
  FavoriteResponse,
  FavoriteStatusResponse,
  FavoriteUpdateRequest,
} from "../types/api";

export interface ListFavoritesParams {
  q?: string;
  category?: FavoriteCategory;
  tags?: string[];
  sort?: "recently_liked" | "recently_used" | "most_used" | "name";
  limit?: number;
  offset?: number;
}

export const favoritesApi = {
  list: (params?: ListFavoritesParams) =>
    api.get<{ data: FavoriteListResponse }>("/api/v1/favorites/", { params }).then((r) => r.data.data),

  get: (id: string) =>
    api.get<{ data: FavoriteResponse }>(`/api/v1/favorites/${id}`).then((r) => r.data.data),

  status: (promptVersionId: string) =>
    api
      .get<{ data: FavoriteStatusResponse }>(`/api/v1/favorites/status`, {
        params: { prompt_version_id: promptVersionId },
      })
      .then((r) => r.data.data),

  create: (body: FavoriteCreateRequest) =>
    api.post<{ data: FavoriteResponse }>("/api/v1/favorites/", body).then((r) => r.data.data),

  update: (id: string, body: FavoriteUpdateRequest) =>
    api.patch<{ data: FavoriteResponse }>(`/api/v1/favorites/${id}`, body).then((r) => r.data.data),

  remove: (id: string) => api.delete(`/api/v1/favorites/${id}`),

  removeByVersion: (promptVersionId: string) =>
    api.delete(`/api/v1/favorites/by-version/${promptVersionId}`),

  tags: () =>
    api.get<{ data: { tags: string[] } }>("/api/v1/favorites/tags").then((r) => r.data.data),

  incrementUse: (id: string) =>
    api.post<{ data: unknown }>(`/api/v1/favorites/${id}/use`).then((r) => r.data.data),
};
