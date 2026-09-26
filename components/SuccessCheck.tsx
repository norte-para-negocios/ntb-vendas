'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react';
import { SPRING_UI } from '@/lib/motion';

// Check de confirmação ao finalizar pagamento (redesign estilo Apple, Task 10
// Step 8). É SÓ visual e nunca segura o fluxo: `flashSuccessCheck()` é
// "dispara e esquece" — o fechamento da janela, a impressão e a emissão
// fiscal seguem exatamente no mesmo instante de antes. Por isso o check vive
// num viewport próprio montado na raiz (fora da janela que fecha), passa por
// cima de tudo sem capturar clique e some sozinho.

let push: (() => void) | null = null;

export function flashSuccessCheck() {
  push?.();
}

const VISIBLE_MS = 900;

export function SuccessCheckViewport() {
  const [shownAt, setShownAt] = useState<number | null>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    push = () => setShownAt(Date.now());
    return () => { push = null; };
  }, []);

  useEffect(() => {
    if (shownAt === null) return;
    const t = setTimeout(() => setShownAt(null), VISIBLE_MS);
    return () => clearTimeout(t);
  }, [shownAt]);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {shownAt !== null && (
          <motion.div
            key={shownAt}
            aria-hidden
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={SPRING_UI}
            className="fixed left-1/2 top-1/2 z-[120] -ml-[60px] -mt-[60px] w-[120px] h-[120px] rounded-[28px] pointer-events-none flex items-center justify-center bg-[var(--surface)]/85 backdrop-blur-xl"
            style={{ boxShadow: '0 20px 60px -12px rgba(0,0,0,0.28), 0 0 0 1px var(--border)' }}
          >
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <motion.circle
                cx="32" cy="32" r="28"
                stroke="var(--ok)" strokeWidth="4"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              />
              <motion.path
                d="M20 33 L28.5 41.5 L44 24"
                stroke="var(--ok)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
                initial={reduce ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              />
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
