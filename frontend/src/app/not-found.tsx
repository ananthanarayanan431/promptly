import Link from 'next/link';
import { Lightbulb, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="text-center space-y-6 max-w-md">
        <div className="flex items-center justify-center gap-2 text-primary">
          <Lightbulb className="h-8 w-8" />
          <span className="text-xl font-bold">Promptly</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-6xl font-black text-foreground">404</h1>
          <h2 className="text-xl font-semibold text-foreground">Page not found</h2>
          <p className="text-sm text-muted-foreground">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>
        <Link
          href="/optimize"
          className="inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-5 py-2.5 text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Promptly
        </Link>
      </div>
    </div>
  );
}
