'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, HelpCircle } from 'lucide-react';
import { Button, Input } from '@/components/ui';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
  requireText?: string;
}

let openImpl: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;

export function confirm(opts: ConfirmOptions | string): Promise<boolean> {
  const options = typeof opts === 'string' ? { message: opts } : opts;
  if (!openImpl) return Promise.resolve(window.confirm(options.message));
  return openImpl(options);
}

export function ConfirmDialogRoot() {
  const [state, setState] = useState<{ options: ConfirmOptions } | null>(null);
  const [typed, setTyped] = useState('');
  const resolveRef = useRef<(v: boolean) => void>(undefined);

  useEffect(() => {
    openImpl = (options) =>
      new Promise<boolean>((resolve) => {
        resolveRef.current?.(false); // um aviso novo por cima de outro: o de baixo vale como Cancelar (nunca fica pendurado)
        resolveRef.current = resolve;
        setTyped('');
        setState({ options });
      });
    return () => { openImpl = null; };
  }, []);

  // Aberto por cima de uma janela (ex.: a da mesa): o foco vem para o aviso e o Esc fecha só o aviso, não a janela de baixo.
  const caixaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!state) return;
    caixaRef.current?.querySelector<HTMLElement>('input, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      resolveRef.current?.(false);
      resolveRef.current = undefined;
      setState(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [state]);

  if (!state) return null;
  const { options } = state;
  const danger = options.variant === 'danger';
  const locked = !!options.requireText && typed !== options.requireText;

  const finish = (v: boolean) => { resolveRef.current?.(v); resolveRef.current = undefined; setState(null); };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 animate-[fadeIn_0.2s_ease-out]" onClick={() => finish(false)}>
      <div
        ref={caixaRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={options.title || options.message}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-[var(--surface)] rounded-[var(--r-lg)] p-6 animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]"
        style={{ boxShadow: 'var(--shadow-md), 0 0 0 1px var(--border)' }}
      >
        <div className={`w-11 h-11 rounded-full flex items-center justify-center mb-4 ${danger ? 'bg-[var(--err)]/10 text-[var(--err)]' : 'bg-[var(--brand)]/10 text-[var(--brand)]'}`}>
          {danger ? <AlertTriangle size={20} /> : <HelpCircle size={20} />}
        </div>
        {options.title && <h3 className="text-[15px] font-semibold text-[var(--text)] mb-1">{options.title}</h3>}
        <p className="text-sm text-[var(--text-muted)] whitespace-pre-line">{options.message}</p>

        {options.requireText && (
          <Input
            className="mt-4"
            placeholder={`Digite "${options.requireText}" para confirmar`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        )}

        <div className="flex gap-2 mt-5">
          <Button variant="secondary" className="flex-1" onClick={() => finish(false)}>
            {options.cancelLabel || 'Cancelar'}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} className="flex-1" disabled={locked} onClick={() => finish(true)}>
            {options.confirmLabel || 'Confirmar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
