import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

  // Protect dashboard routes — public landing page at / is exempt
  const isProtected =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname.startsWith('/optimize') ||
    pathname.startsWith('/versions') ||
    pathname.startsWith('/analyze');

  if (isProtected && !token) {
    // Send unauthenticated visitors to the landing page so they see the product first
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Redirect authenticated users away from auth pages to the app
  if (token && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/optimize', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard',
    '/dashboard/:path*',
    '/login',
    '/register',
    '/optimize/:path*',
    '/versions/:path*',
    '/analyze/:path*',
  ],
};
