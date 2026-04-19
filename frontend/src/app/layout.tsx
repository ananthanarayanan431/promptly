import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Instrument_Serif } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';
import { cookies } from 'next/headers';
import { AuthInitializer } from '@/components/auth-initializer';

const geist = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist',
  display: 'swap',
});

const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  display: 'swap',
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-instrument-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Promptly — prompt optimization',
  description: 'Paste your prompt. Let the council improve it.',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const token = cookies().get('auth_token')?.value || null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geist.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
            style={{ fontFamily: 'var(--font-geist), ui-sans-serif, system-ui, sans-serif' }}>
        <AuthInitializer token={token} />
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
