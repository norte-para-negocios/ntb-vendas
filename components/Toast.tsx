'use client';

import { forwardRef, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { AnimatePresence, MotionConfig, motion, useDragControls } from 'motion/react';
import { SPRING_SHEET, SPRING_UI } from '@/lib/motion';

type ToastVariant = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; variant: ToastVariant; duration: number; }

let push: ((t: Omit<ToastItem, 'id'>) => void) | null = null;
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
    const timers = new Set<ReturnType<typeof setTimeout>>();
    push = (t) => {
      const id = counter++;
      setItems((prev) => [...prev, { ...t, id }]);
      // Cada aviso tem o próprio relógio (antes todos reiniciavam quando um
      // novo entrava ou saía).
      const timer = setTimeout(() => { timers.delete(timer); setItems((prev) => prev.filter((x) => x.id !== id)); }, t.duration);
      timers.add(timer);
    };
    return () => { push = null; timers.forEach(clearTimeout); };
  }, []);

  // Redesign estilo Apple (Task 10 Step 5): aviso entra de cima como
  // notificação do iPhone (SPRING_SHEET), some subindo, e arrastar pra cima
  // dispensa. AnimatePresence cuida da saída — o item sai da lista na hora.
  const dismiss = (id: number) => setItems((prev) => prev.filter((t) => t.id !== id));

  return (
    <MotionConfig reducedMotion="user">
      <div
        role="status"
        aria-live="polite"
        className="fixed top-[max(1rem,env(safe-area-inset-top))] right-4 z-[100] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
      >
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <ToastCard key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

// Arrastar pra cima dispensa — só no toque (no mouse o texto continua
// selecionável, tem aviso com texto pra copiar).
const ToastCard = forwardRef<HTMLDivElement, { item: ToastItem; onDismiss: () => void }>(function ToastCard({ item: t, onDismiss }, ref) {
  const { icon: Icon, color } = VARIANT[t.variant];
  const dragControls = useDragControls();
  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -24, transition: SPRING_UI }}
      transition={SPRING_SHEET}
      drag="y"
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.6, bottom: 0.05 }}
      onPointerDown={(e) => { if (e.pointerType !== 'mouse') dragControls.start(e); }}
      onDragEnd={(_e, info) => {
        if (info.offset.y < -30 || info.velocity.y < -300) onDismiss();
      }}
      className="pointer-events-auto max-md:touch-none flex items-start gap-2.5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-sm"
      style={{ boxShadow: 'var(--shadow-md)' }}
    >
      <Icon size={18} style={{ color }} className="shrink-0 mt-0.5" />
      <p className="flex-1 text-[var(--text)] whitespace-pre-line">{t.message}</p>
      <button onClick={onDismiss} aria-label="Fechar aviso" className="relative hit-44 text-[var(--text-muted)] hover:text-[var(--text)] u-motion shrink-0">
        <X size={14} />
      </button>
    </motion.div>
  );
});
