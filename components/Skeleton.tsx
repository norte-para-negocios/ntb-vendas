export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`u-skeleton rounded-[var(--r-md)] ${className}`} style={style} aria-hidden="true" />;
}

export const stagger = (ms: number) => ({ '--stagger': `${ms}ms` }) as React.CSSProperties;
