import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';

function isSafeRedirectPath(path: string): boolean {
  // Block protocol-relative (//), schemes (:), and backslashes — WHATWG URL parsing
  // treats \\ as / in special schemes, so /\evil.com resolves to //evil.com (open redirect).
  return path.startsWith('/') && !path.startsWith('//') && !path.includes(':') && !path.includes('\\');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next') ?? '/optimize';
  const next = isSafeRedirectPath(rawNext) ? rawNext : '/optimize';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error('OAuth code exchange failed:', error.message);
      return NextResponse.redirect(new URL('/sign-in?error=auth', request.url));
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
