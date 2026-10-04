'use client';
import React, { useEffect, useRef, useState } from 'react';

export const SettingRow: React.FC<{ titulo: React.ReactNode; descricao: React.ReactNode; children: React.ReactNode; id?: string }> = ({ titulo, descricao, children, id }) => (
  <div id={id} className="flex items-center justify-between gap-x-4 gap-y-3 flex-wrap p-4 bg-[var(--surface-2)] rounded-[14px] scroll-mt-24 max-sm:flex-col max-sm:items-stretch">
    <div className="min-w-0 flex-1 basis-64">
      <h4 className="font-semibold text-[15px] text-[var(--text)]">{titulo}</h4>
      <p className="text-[13px] text-[var(--text-muted)] mt-0.5">{descricao}</p>
    </div>
    <div className="flex-shrink-0 max-sm:self-end">{children}</div>
  </div>
);

export const Switch: React.FC<{ ligado: boolean; onChange: () => void; rotulo: string }> = ({ ligado, onChange, rotulo }) => (
  <button
    type="button" role="switch" aria-checked={ligado} aria-label={rotulo} onClick={onChange}
    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 max-sm:my-2.5 ${ligado ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}
  >
    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${ligado ? 'translate-x-6' : 'translate-x-1'}`} />
  </button>
);

/** Número que grava sozinho ~700 ms depois de parar de digitar (ou ao sair do campo). */
export const NumberField: React.FC<{ valor: number; onChange: (n: number) => void; prefixo?: string; sufixo?: string; rotulo: string; largura?: string }> = ({ valor, onChange, prefixo, sufixo, rotulo, largura = 'w-20' }) => {
  const [rascunho, setRascunho] = useState<string>(String(valor));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimo = useRef(valor);
  useEffect(() => { ultimo.current = valor; setRascunho(String(valor)); }, [valor]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const confirmar = (texto: string) => {
    const n = Math.max(0, Number(texto) || 0);
    if (n !== ultimo.current) { ultimo.current = n; onChange(n); }
  };
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
      {prefixo}
      <input
        type="number" min={0} step={5} value={rascunho} aria-label={rotulo}
        onChange={(e) => {
          setRascunho(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          const t = e.target.value;
          timer.current = setTimeout(() => confirmar(t), 700);
        }}
        onBlur={(e) => { if (timer.current) clearTimeout(timer.current); confirmar(e.target.value); }}
        className={`${largura} h-9 max-sm:h-11 px-2 rounded-[var(--r-md)] bg-[var(--surface)] text-[var(--text)] text-[15px] max-sm:text-base font-semibold num text-center focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/40`}
      />
      {sufixo}
    </label>
  );
};
