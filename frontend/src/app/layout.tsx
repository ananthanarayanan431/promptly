import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from '@/components/ui/sonner';
import { cookies } from 'next/headers';
import { AuthInitializer } from '@/components/auth-initializer';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Promptly - AI Prompt Optimization',
  description: 'AI prompt optimization platform using a multi-model council.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const token = cookies().get('auth_token')?.value || null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <AuthInitializer token={token} />
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
