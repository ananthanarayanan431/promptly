import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function buildCsp(): string {
  const isProd = process.env.NODE_ENV === 'production';
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

  const scriptSrc = isProd
    ? ["script-src 'self'"]
    : ["script-src 'self' 'unsafe-eval' 'unsafe-inline'"];

  const connectSrc = isProd
    ? [`connect-src 'self' ${apiUrl}`]
    : [`connect-src 'self' ${apiUrl} ws://localhost:*`];

  return [
    "default-src 'self'",
    ...scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    ...connectSrc,
    "frame-ancestors 'none'",
  ].join('; ');
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth_token')?.value;
  const { pathname } = request.nextUrl;

  // Protect dashboard routes — public landing page at / is exempt
  const isProtected =
    pathname === '/dashboard' ||
    pathname.startsWith('/dashboard/') ||
    pathname === '/optimize' ||
    pathname.startsWith('/optimize/') ||
    pathname.startsWith('/versions') ||
    pathname.startsWith('/analyze') ||
    pathname === '/history' ||
    pathname === '/billing';

  if (isProtected && !token) {
    // Send unauthenticated visitors to the landing page so they see the product first
    return NextResponse.redirect(new URL('/', request.url));
  }

  // Redirect authenticated users away from auth pages to the app
  if (token && (pathname === '/login' || pathname === '/register')) {
    return NextResponse.redirect(new URL('/optimize', request.url));
  }

  const response = NextResponse.next();
  response.headers.set('Content-Security-Policy', buildCsp());
  return response;
}

export const config = {
  matcher: [
    /*
     * Run middleware for app routes only — never for Next internals or static assets.
     * Omitting this exclusion can cause 404s or broken JS/CSS when auth middleware
     * runs on `/_next/static/*` in some setups.
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
