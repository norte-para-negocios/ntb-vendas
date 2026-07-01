import { Skeleton, stagger } from '@/components/Skeleton';

export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--ink)] p-4">
      <div className="w-full max-w-sm space-y-4">
        <Skeleton className="u-stagger h-7 w-32 mx-auto" style={stagger(0)} />
        <Skeleton className="u-stagger h-3 w-24 mx-auto" style={stagger(30)} />
        <div className="space-y-3 pt-4">
          <Skeleton className="u-stagger h-11 w-full" style={stagger(70)} />
          <Skeleton className="u-stagger h-11 w-full" style={stagger(100)} />
          <Skeleton className="u-stagger h-11 w-full" style={stagger(140)} />
        </div>
      </div>
    </div>
  );
}
