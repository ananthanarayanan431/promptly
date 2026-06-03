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
  (auth)/sign-in       → /sign-in   (email/password + OAuth via AuthForm)
  (auth)/sign-up       → /sign-up
  auth/callback        → OAuth code-exchange route handler (sets the session cookie)
  sso-callback         → legacy compat shim; forwards to /auth/callback
  (dashboard)/         → authenticated app (sidebar + header layout)
  (dashboard)/optimize → main prompt optimization page
```

The `(dashboard)` group is gated by `middleware.ts`; unauthenticated users are redirected to `/sign-in`.

### Auth (Supabase)

Auth uses **Supabase** via `@supabase/ssr`:

- `lib/supabase.ts` — browser client (`createClient`) for client components.
- `lib/supabase-server.ts` — `createMiddlewareClient` used by `middleware.ts` to refresh
  the session cookie on every request (`supabase.auth.getUser()`).
- `app/auth/callback/route.ts` — exchanges the OAuth `?code` for a session
  (`exchangeCodeForSession`) with safe-redirect validation, then redirects to `next` (default `/optimize`).
- `components/auth/auth-form.tsx` + `social-buttons.tsx` — email/password and OAuth UI.

The axios instance in `lib/api.ts` attaches the Supabase access token as `Authorization: Bearer`
and handles 401 globally. The previous custom-JWT cookie flow, Zustand token store, and
page-load hydration component were removed in the Supabase migration.

### Data Fetching Patterns

- **Server components** fetch initial data directly (no useEffect, no loading states needed)
- **Client components** use TanStack Query for anything interactive or polling-based
- `src/hooks/use-job-stream.ts` — streams job progress (SSE) with a polling fallback; stops on a terminal `completed`/`failed` status.

### API Layer

All HTTP calls go through the single axios instance in `src/lib/api.ts`. Never use raw `fetch` for backend calls. The instance:
- Sets `baseURL` from `NEXT_PUBLIC_API_URL`
- Attaches a fresh Supabase access token as `Authorization: Bearer <token>` on every request, via a per-request getter registered by `SupabaseTokenSync` (`registerTokenGetter` → `supabase.auth.getSession()`)
- Redirects to `/sign-in` on any 401 (expired or revoked session)

### Types and Validation

- `src/types/api.ts` — TypeScript interfaces mirroring all backend response shapes
- `src/lib/schemas.ts` — Zod schemas for form validation (React Hook Form + `@hookform/resolvers/zod`)

### Component Conventions

- `src/components/ui/` — shadcn-generated components; do not edit directly
- Feature components live in subdirectories matching the route: `optimize/`, `analyze/`, `versions/`, `layout/`
- `"use client"` only where interactivity is required; page shells and layouts are server components
