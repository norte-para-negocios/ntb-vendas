'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';

interface AlertOptions {
  title?: string;
  message: string;
  okLabel?: string;
}

let openImpl: ((opts: AlertOptions) => Promise<void>) | null = null;

// Fix round 1 (Task 2 review, Important #2) — alerta bloqueante, deliberadamente
// diferente dos dois mecanismos de aviso que já existem neste projeto:
//   - `toast.error()` (components/Toast.tsx) some sozinho depois de alguns
//     segundos (padrão 4s) — um garçom andando pela sala, sem olhar pra tela
//     bem naquele instante, nunca chega a ver.
//   - `confirm()` (components/ConfirmDialog.tsx) fecha ao clicar fora do
//     modal (`onClick={() => finish(false)}` no backdrop) — apropriado pra
//     "tem certeza?", errado pra um aviso que precisa ser lido: um toque sem
//     querer fora da caixa dispensa o aviso sem o garçom nunca tê-lo lido.
// `alertError()` não tem timeout nem dismiss por clique no fundo — exige um
// toque explícito no botão. Motivado especificamente pela falha silenciosa
// de impressão do fluxo direct_print (Task 2): nessa loja a impressão é o
// ÚNICO jeito do pedido chegar na cozinha, então "quase ver" o aviso não é
// bom o suficiente.
export function alertError(opts: AlertOptions | string): Promise<void> {
  const options = typeof opts === 'string' ? { message: opts } : opts;
  if (!openImpl) {
    // Fallback antes do AlertDialogRoot montar (mesmo padrão de confirm()
    // com window.confirm) — não deveria acontecer em uso normal, já que
    // AlertDialogRoot vive no layout raiz.
    window.alert(options.message);
    return Promise.resolve();
  }
  return openImpl(options);
}

export function AlertDialogRoot() {
  const [state, setState] = useState<{ options: AlertOptions } | null>(null);
  const resolveRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    openImpl = (options) =>
      new Promise<void>((resolve) => {
        resolveRef.current = resolve;
        setState({ options });
      });
    return () => { openImpl = null; };
  }, []);

  if (!state) return null;
  const { options } = state;

  const finish = () => {
    resolveRef.current?.();
    setState(null);
  };

  return (
    // Sem onClick no backdrop de propósito — clicar fora NÃO fecha (ver
    // comentário de alertError acima pro porquê disso importar aqui).
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 animate-[fadeIn_0.2s_ease-out]">
      <div
        role="alertdialog"
        aria-modal="true"
        className="w-full max-w-sm bg-[var(--surface)] rounded-[var(--r-lg)] p-6 animate-[slideUp_0.25s_cubic-bezier(0.22,1,0.36,1)]"
        style={{ boxShadow: 'var(--shadow-md), 0 0 0 1px var(--border)' }}
      >
        <div className="w-11 h-11 rounded-full flex items-center justify-center mb-4 bg-[var(--err)]/10 text-[var(--err)]">
          <AlertTriangle size={20} />
        </div>
        {options.title && <h3 className="text-[15px] font-semibold text-[var(--text)] mb-1">{options.title}</h3>}
        <p className="text-sm text-[var(--text-muted)] whitespace-pre-line">{options.message}</p>

        <div className="flex mt-5">
          <Button variant="danger" className="flex-1" onClick={finish}>
            {options.okLabel || 'Entendi'}
          </Button>
        </div>
      </div>
    </div>
  );
}
