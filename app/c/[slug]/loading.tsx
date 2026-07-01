import { Skeleton, stagger } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen bg-[var(--bg)] p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 py-4">
        <Skeleton className="w-12 h-12 rounded-[var(--r-lg)]" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>

      <div className="flex gap-2 pb-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="u-stagger h-8 w-20 shrink-0 rounded-full" style={stagger(i * 30)} />
        ))}
      </div>

      <div className="grid gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="u-stagger flex gap-3 p-3" style={stagger(Math.min(i, 10) * 30)}>
            <Skeleton className="w-20 h-20 rounded-[var(--r-sm)] shrink-0" />
            <div className="flex-1 space-y-2 py-1">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
