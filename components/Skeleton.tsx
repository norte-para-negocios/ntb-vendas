export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`u-skeleton rounded-[var(--r-md)] ${className}`} aria-hidden="true" />;
}

export const stagger = (ms: number) => ({ '--stagger': `${ms}ms` }) as React.CSSProperties;
