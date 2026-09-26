'use client';

import { useLayoutEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'motion/react';

// Número que conta até o valor novo (redesign estilo Apple, Task 10 Step 7).
//
// Garantias:
// - O valor FINAL exibido é sempre `format(value)` exato (onComplete grava o
//   texto definitivo; nada de arredondamento intermediário sobrando).
// - A troca começa no mesmo frame em que o valor muda — não atrasa nada; se o
//   valor mudar de novo no meio da contagem, recomeça do número que está NA
//   TELA naquele instante (não do alvo antigo), sem salto.
// - No primeiro render mostra o valor direto (abrir uma janela não "conta do
//   zero").
// - Movimento reduzido: troca direto pro valor final.
// - O texto é escrito direto no DOM (sem re-render por frame). O <span> não
//   tem filhos React de propósito, pra o React nunca brigar com o texto.
// Use com a classe `.num` (tabular-nums) no contêiner pra não tremer.
export function AnimatedNumber({
  value,
  format,
  duration = 0.3,
  className,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shownRef = useRef<number | null>(null);
  const formatRef = useRef(format);
  formatRef.current = format;
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fmt = formatRef.current;
    const from = shownRef.current;
    const setText = (n: number) => { el.textContent = fmt(n); };
    if (from === null || reduce || !Number.isFinite(value) || !Number.isFinite(from) || from === value) {
      shownRef.current = value;
      setText(value);
      return;
    }
    const controls = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (n) => { shownRef.current = n; setText(n); },
      onComplete: () => { shownRef.current = value; setText(value); },
    });
    return () => {
      controls.stop();
    };
  }, [value, duration, reduce]);

  // Formato mudou sem o valor mudar (raro): reescreve o texto final.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && shownRef.current === value) el.textContent = format(value);
  }, [format, value]);

  return <span ref={ref} className={className} />;
}
