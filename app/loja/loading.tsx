import { Skeleton, stagger } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)] p-4">
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="u-stagger w-12 h-12 rounded-[var(--r-lg)] mx-auto" style={stagger(0)} />
        <Skeleton className="u-stagger h-4 w-40 mx-auto" style={stagger(40)} />
        <div className="space-y-3 pt-4">
          <Skeleton className="u-stagger h-11 w-full" style={stagger(80)} />
          <Skeleton className="u-stagger h-11 w-full" style={stagger(110)} />
          <Skeleton className="u-stagger h-11 w-full" style={stagger(150)} />
        </div>
      </div>
    </div>
  );
}
