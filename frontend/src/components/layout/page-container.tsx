export function PageContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto p-6 md:p-8">
      <div className="mx-auto max-w-5xl w-full">
        {children}
      </div>
    </div>
  );
}
