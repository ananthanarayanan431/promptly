# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev     # Next.js dev server on :3000
npm run build   # production build
npm run lint    # ESLint (next lint)
```

**Environment:** create `.env.local` with:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Architecture

**Stack:** Next.js 14 (App Router) + TypeScript strict + Tailwind CSS + shadcn/ui + TanStack Query v5 + Zustand + React Hook Form + Zod + axios

### Route Groups

```
src/app/
  (auth)/login        → /login
  (auth)/register     → /register
  (dashboard)/        → / (dashboard home)
  (dashboard)/optimize    → main prompt optimization page
  (dashboard)/versions    → list of versioned prompt families
  (dashboard)/versions/[id] → version history for one family
  (dashboard)/analyze     → health-score + advisory tools
  api/auth/           → Next.js API route that manages the httpOnly auth cookie
```

The `(dashboard)` group shares a layout (`src/app/(dashboard)/layout.tsx`) that renders the sidebar and header.

### Auth Token Flow

Token storage uses a **two-layer pattern** to satisfy both server-side middleware and client-side axios:

1. **httpOnly cookie** (`auth_token`) — set/cleared by the Next.js API route at `src/app/api/auth/route.ts` via `lib/auth.ts`. Read by `middleware.ts` to protect dashboard routes before React renders.
2. **Zustand store** (`src/stores/auth-store.ts`) — holds the token in memory for the axios request interceptor.

On page load, `AuthInitializer` (a client component rendered in the dashboard layout) hydrates the Zustand store from the cookie by reading the token server-side and passing it as a prop. This means the axios interceptor always has the token available without an extra fetch.

On 401, the axios response interceptor (`src/lib/api.ts`) logs out the Zustand store, deletes the cookie via the API route, and redirects to `/login`.

### Data Fetching Patterns

- **Server components** fetch initial data directly (no useEffect, no loading states needed)
- **Client components** use TanStack Query for anything interactive or polling-based
- `src/hooks/use-job-poller.ts` — polls `GET /api/v1/chat/jobs/{id}` every 2 seconds; stops automatically when `status` is `completed` or `failed`

### API Layer

All HTTP calls go through the single axios instance in `src/lib/api.ts`. Never use raw `fetch` for backend calls. The instance:
- Sets `baseURL` from `NEXT_PUBLIC_API_URL`
- Attaches `Authorization: Bearer <token>` from Zustand on every request
- Handles 401 globally (logout + redirect)

### Types and Validation

- `src/types/api.ts` — TypeScript interfaces mirroring all backend response shapes
- `src/lib/schemas.ts` — Zod schemas for form validation (React Hook Form + `@hookform/resolvers/zod`)

### Component Conventions

- `src/components/ui/` — shadcn-generated components; do not edit directly
- Feature components live in subdirectories matching the route: `optimize/`, `analyze/`, `versions/`, `layout/`
- `"use client"` only where interactivity is required; page shells and layouts are server components
