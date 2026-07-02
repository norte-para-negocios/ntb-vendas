'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; variant: ToastVariant; duration: number; leaving?: boolean; }

let push: ((t: Omit<ToastItem, 'id' | 'leaving'>) => void) | null = null;
let counter = 0;

function show(message: string, variant: ToastVariant, duration = 4000) {
  push?.({ message, variant, duration });
}

export const toast = {
  success: (msg: string, duration?: number) => show(msg, 'success', duration),
  error: (msg: string, duration?: number) => show(msg, 'error', duration),
  warning: (msg: string, duration?: number) => show(msg, 'warning', duration),
  info: (msg: string, duration?: number) => show(msg, 'info', duration),
};

const VARIANT: Record<ToastVariant, { icon: typeof CheckCircle2; color: string }> = {
  success: { icon: CheckCircle2, color: 'var(--ok)' },
  error: { icon: XCircle, color: 'var(--err)' },
  warning: { icon: AlertTriangle, color: 'var(--warn)' },
  info: { icon: Info, color: 'var(--info)' },
};

export function ToastViewport() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    push = (t) => setItems((prev) => [...prev, { ...t, id: counter++ }]);
    return () => { push = null; };
  }, []);

  const dismiss = (id: number) =>
    setItems((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));

  useEffect(() => {
    const timers = items
      .filter((t) => !t.leaving)
      .map((t) => setTimeout(() => dismiss(t.id), t.duration));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
    >
      {items.map((t) => {
        const { icon: Icon, color } = VARIANT[t.variant];
        return (
          <div
            key={t.id}
            onAnimationEnd={() => t.leaving && setItems((p) => p.filter((x) => x.id !== t.id))}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm ${t.leaving ? 'u-toast-out' : 'animate-slide-up'}`}
            style={{ boxShadow: 'var(--shadow-md)' }}
          >
            <Icon size={18} style={{ color }} className="shrink-0 mt-0.5" />
            <p className="flex-1 text-[var(--text)] whitespace-pre-line">{t.message}</p>
            <button onClick={() => dismiss(t.id)} className="text-[var(--text-muted)] hover:text-[var(--text)] u-motion shrink-0">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
