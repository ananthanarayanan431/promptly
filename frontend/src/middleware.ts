import { type NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient } from '@/lib/supabase-server';

const PUBLIC_ROUTES = ['/', '/sign-in', '/sign-up', '/sso-callback', '/auth/callback'];
const AUTH_ROUTES = ['/sign-in', '/sign-up'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // API routes are authenticated by the FastAPI backend — skip middleware auth.
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  const { supabase, response } = createMiddlewareClient(request);

  // getUser() refreshes the session cookie when needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPublic = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  );

  if (!user && !isPublic) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  if (user && AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL('/optimize', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
