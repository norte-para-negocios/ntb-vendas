'use client';
// Planta de mesas. Cada quadradinho é uma mesa. Toque para abrir a conta; o gerente arruma em "Editar planta".
// O mapa nunca abre vazio: mesa sem posição salva aparece em posição automática (não gravada até alguém salvar).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pencil, Check, X, Info, LayoutGrid } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { SPRING_UI, SPRING_TAP } from '@/lib/motion';
import type { Table } from '@/types';
import type { PosicaoMesa } from '@/lib/api';
import { toast } from '@/components/Toast';
import { autoLayout, resolverPosicoes, soltar, larguraMinimaPx, rotulosDeArea, areasDe, mesasNoIntervalo, type Pos } from '@/lib/planta';

export interface FloorPlanTableInfo {
  dotColor: string;
  statusLabel: string;
  inJurisdiction: boolean;
  blocked: boolean;
  /** Há quantos minutos a mesa está ocupada (null = livre/sem itens). */
  minutes?: number | null;
  /** Passou do limite configurado da loja? */
  alerta?: 'warn' | 'err' | null;
}

interface Props {
  tables: Table[];
  info: (table: Table) => FloorPlanTableInfo;
  onOpen: (table: Table) => void;
  canEdit: boolean;
  onMoveMany: (itens: PosicaoMesa[]) => Promise<boolean>;
}

const DICA_KEY = 'ntb-planta-dica-v1';
const clamp = (n: number) => Math.min(100, Math.max(0, n));
const LEGENDA: { cor: string; texto: string }[] = [
  { cor: 'var(--ok)', texto: 'Livre' },
  { cor: 'var(--brand)', texto: 'Ocupada' },
  { cor: 'var(--warn)', texto: 'Pediu a conta' },
  { cor: 'var(--err)', texto: 'Chamando o garçom' },
  { cor: 'var(--text-muted)', texto: 'Bloqueada' },
];

export const FloorPlanView: React.FC<Props> = ({ tables, info, onOpen, canEdit, onMoveMany }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [soOcupadas, setSoOcupadas] = useState(() => tables.length > 60);
  const autoOcupadasFeito = useRef(tables.length > 60);
  const [areaSel, setAreaSel] = useState<string>('todas');
  const [confirmandoOrg, setConfirmandoOrg] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [mostrarDica, setMostrarDica] = useState(false);
  const [areaNome, setAreaNome] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const reduzMovimento = useReducedMotion();
  // Ao organizar, as mesas "assentam" em sequência curta (teto de 300 ms no total, mesmo com 500 mesas).
  const [assentando, setAssentando] = useState(false);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  // As mesas podem chegar depois da primeira renderização: a regra "mais de 60 abre só com ocupadas" vale uma vez.
  useEffect(() => { if (!autoOcupadasFeito.current && tables.length > 60) { autoOcupadasFeito.current = true; setSoOcupadas(true); } }, [tables.length]);
  // localStorage só existe no navegador: lê depois da hidratação (ler no useState quebraria o SSR).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { try { setMostrarDica(localStorage.getItem(DICA_KEY) !== '1'); } catch { setMostrarDica(true); } }, []);
  const fecharDica = () => { setMostrarDica(false); try { localStorage.setItem(DICA_KEY, '1'); } catch { /* sem storage: só reaparece */ } };
  useEffect(() => { if (!confirmandoOrg) return; const t = setTimeout(() => setConfirmandoOrg(false), 5000); return () => clearTimeout(t); }, [confirmandoOrg]);

  const { posicoes, cols, naoSalvas } = useMemo(() => resolverPosicoes(tables), [tables]);
  const areas = useMemo(() => areasDe(tables), [tables]);
  const rotulos = useMemo(() => rotulosDeArea(tables, posicoes), [tables, posicoes]);
  const largura = larguraMinimaPx(cols);

  const filtrarOcupadas = soOcupadas && !editing;
  const visiveis = tables.filter((t) => {
    if (areaSel !== 'todas' && (t.area ?? '') !== areaSel) return false;
    if (filtrarOcupadas && !(t.status === 'occupied' || t.status === 'waiting_bill')) return false;
    return true;
  });

  const pointToPercent = (clientX: number, clientY: number) => {
    const r = mapRef.current?.getBoundingClientRect();
    if (!r || r.width === 0 || r.height === 0) return null;
    return { x: clamp(((clientX - r.left) / r.width) * 100), y: clamp(((clientY - r.top) / r.height) * 100) };
  };

  const onPointerDown = (e: React.PointerEvent, t: Table) => {
    if (!editing) return;
    dragRef.current = { id: t.id, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const p = pointToPercent(e.clientX, e.clientY);
    if (!p) return;
    d.moved = true;
    setDragPos({ id: d.id, ...p });
  };
  const onPointerUp = async (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragPos(null);
    if (!d || !d.moved) return;
    const r = mapRef.current?.getBoundingClientRect();
    const fora = !!r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    const p = pointToPercent(e.clientX, e.clientY);
    if (fora || !p) return; // soltou fora do mapa = cancela o arrasto
    const atuais: Pos[] = Array.from(posicoes.entries()).map(([id, v]) => ({ id, x: v.x, y: v.y }));
    await onMoveMany(soltar(d.id, p, atuais, cols).map((m) => ({ id: m.id, x: m.x, y: m.y })));
  };

  const salvar = async (itens: PosicaoMesa[], okMsg: string) => {
    if (itens.length === 0) { toast.info('Nada para salvar.'); return; }
    setSalvando(true);
    setAssentando(true);
    const ok = await onMoveMany(itens);
    setSalvando(false);
    setTimeout(() => setAssentando(false), 600);
    if (ok) toast.success(okMsg);
  };
  const organizarTudo = () => {
    if (!confirmandoOrg) { setConfirmandoOrg(true); return; }
    setConfirmandoOrg(false);
    void salvar(autoLayout(tables, { soFaltantes: false }).pos.map((p) => ({ id: p.id, x: p.x, y: p.y })), 'Mesas organizadas.');
  };
  const posicionarFaltantes = () => void salvar(autoLayout(tables, { soFaltantes: true }).pos.map((p) => ({ id: p.id, x: p.x, y: p.y })), 'Posições salvas.');
  const aplicarArea = () => {
    const a = Number(de);
    const b = Number(ate);
    const ids = Number.isFinite(a) && Number.isFinite(b) && de !== '' && ate !== '' ? mesasNoIntervalo(tables, a, b) : [];
    if (ids.length === 0) { toast.error('Digite de qual mesa até qual mesa (ex.: 1 até 20).'); return; }
    void salvar(ids.map((id) => ({ id, area: areaNome.trim() || null })), areaNome.trim() ? `Área "${areaNome.trim()}" aplicada a ${ids.length} mesas.` : `Área removida de ${ids.length} mesas.`);
  };

  const pin = (t: Table) => {
    const i = info(t);
    const base = posicoes.get(t.id);
    if (!base) return null;
    const pos = dragPos?.id === t.id ? dragPos : base;
    const clicavel = !editing && i.inJurisdiction && !i.blocked;
    const arrastando = dragPos?.id === t.id;
    // Mola do app (SPRING_UI); arrastando, segue o dedo sem mola; ao organizar, atraso curto por mesa (teto 300 ms).
    const ordem = assentando ? Math.min(300, (t.number % 50) * 6) : 0;
    const transicao = reduzMovimento || arrastando ? { duration: 0 } : { ...SPRING_UI, delay: ordem / 1000 };
    return (
      <motion.button
        key={t.id}
        type="button"
        data-mesa
        onPointerDown={(e) => onPointerDown(e, t)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => { if (clicavel) onOpen(t); }}
        initial={false}
        animate={{ left: `${pos.x}%`, top: `${pos.y}%` }}
        transition={transicao}
        whileTap={clicavel && !reduzMovimento ? { scale: 0.96, transition: SPRING_TAP } : undefined}
        style={{ x: '-50%', y: '-50%', touchAction: editing ? 'none' : 'auto', ...(t.status === 'occupied' || t.status === 'waiting_bill' ? { borderColor: i.dotColor, borderWidth: 2 } : {}) }}
        className={`absolute min-w-[44px] min-h-[44px] px-2 rounded-xl border bg-[var(--surface)] shadow-[var(--shadow-sm)] flex flex-col items-center justify-center text-[13px] font-semibold text-[var(--text)] ${
          editing ? 'cursor-grab outline outline-1 outline-dashed outline-[var(--brand)]' : clicavel ? 'hover:shadow-md' : 'opacity-50'
        }`}
        aria-label={`Mesa ${t.number}${t.area ? `, ${t.area}` : ''}, ${i.statusLabel}${i.minutes != null ? `, ocupada há ${i.minutes} minutos` : ''}`}
        title={`Mesa ${t.number} · ${i.statusLabel}`}
      >
        <span className="leading-none">{t.number}</span>
        {i.minutes != null ? (
          <span className="mt-0.5 text-[10px] leading-none font-medium num" style={{ color: i.alerta === 'err' ? 'var(--err)' : i.alerta === 'warn' ? 'var(--warn)' : 'var(--text-muted)' }}>
            {i.minutes >= 60 ? `${Math.floor(i.minutes / 60)}h${String(i.minutes % 60).padStart(2, '0')}` : `${i.minutes}m`}
          </span>
        ) : null}
        <span className="mt-1 h-1.5 w-1.5 rounded-full" style={{ background: i.dotColor }} />
      </motion.button>
    );
  };

  const chip = (ativo: boolean) => `h-9 max-sm:h-11 px-3 rounded-full text-[13px] font-semibold u-press ${ativo ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`;

  return (
    <div className="space-y-3">
      <AnimatePresence initial={false}>
      {mostrarDica && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI} className="flex items-start gap-3 rounded-[14px] bg-[var(--brand-soft)] px-4 py-3 text-[14px] text-[var(--text)]" role="note">
          <Info size={18} className="mt-0.5 shrink-0 text-[var(--brand)]" />
          <p className="flex-1">
            <b>Como funciona:</b>{' '}
            <span className="sm:hidden">cada quadradinho é uma mesa; toque para abrir a conta.</span>
            <span className="max-sm:hidden">cada quadradinho é uma mesa — a bolinha mostra se está livre, ocupada ou pedindo atenção, e o número é há quanto tempo está ocupada. Toque numa mesa para abrir a conta.
            {canEdit ? ' Para mudar as mesas de lugar, toque em “Editar planta”.' : ''}</span>
          </p>
          <button type="button" onClick={fecharDica} aria-label="Fechar a explicação" className="min-h-11 min-w-11 -m-2 grid place-items-center text-[var(--text-muted)]"><X size={16} /></button>
        </motion.div>
      )}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={soOcupadas} onClick={() => setSoOcupadas((v) => !v)} className={chip(filtrarOcupadas)}>Só ocupadas</button>
        {areas.length > 0 && (
          <>
            <button type="button" aria-pressed={areaSel === 'todas'} onClick={() => setAreaSel('todas')} className={chip(areaSel === 'todas')}>Todas as áreas</button>
            {areas.map((a) => <button key={a} type="button" aria-pressed={areaSel === a} onClick={() => setAreaSel(a)} className={chip(areaSel === a)}>{a}</button>)}
          </>
        )}
        {canEdit && (
          <button type="button" onClick={() => { setEditing((v) => !v); setConfirmandoOrg(false); }} className="ml-auto inline-flex items-center gap-1.5 h-9 max-sm:h-11 px-3 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text)] u-press">
            {editing ? <><Check size={14} /> Concluir</> : <><Pencil size={14} /> Editar planta</>}
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
      {canEdit && editing && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI} className="rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-3 space-y-3">
          <p className="text-[13px] text-[var(--text-muted)]">Arraste uma mesa para outro quadradinho (ela encaixa na grade). Soltar em cima de outra mesa troca as duas de lugar.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={salvando} onClick={organizarTudo} className={`${chip(confirmandoOrg)} inline-flex items-center gap-1.5`}>
              <LayoutGrid size={14} /> {confirmandoOrg ? 'Toque de novo para confirmar' : 'Organizar automaticamente'}
            </button>
            {naoSalvas > 0 && (
              <button type="button" disabled={salvando} onClick={posicionarFaltantes} className={chip(false)}>Salvar as {naoSalvas} mesas sem posição</button>
            )}
          </div>
          {confirmandoOrg && <p className="text-[12px] text-[var(--warn)]">Isso coloca TODAS as mesas em grade, por área e número, e perde o arranjo atual.</p>}
          <details className="group">
            <summary className="min-h-11 flex items-center cursor-pointer text-[13px] font-semibold text-[var(--text)]">Agrupar mesas por área</summary>
            <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] text-[var(--text-muted)]">Área
              <input value={areaNome} onChange={(e) => setAreaNome(e.target.value)} maxLength={40} placeholder="Ex.: Varanda" className="block h-11 w-36 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" />
            </label>
            <label className="text-[12px] text-[var(--text-muted)]">Da mesa
              <input value={de} onChange={(e) => setDe(e.target.value)} inputMode="numeric" className="block h-11 w-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" />
            </label>
            <label className="text-[12px] text-[var(--text-muted)]">até a
              <input value={ate} onChange={(e) => setAte(e.target.value)} inputMode="numeric" className="block h-11 w-20 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" />
            </label>
            <button type="button" disabled={salvando} onClick={aplicarArea} className={chip(false)}>Aplicar área</button>
          </div>
          <p className="text-[12px] text-[var(--text-muted)]">Deixe a área em branco para tirar a área dessas mesas. Depois use “Organizar automaticamente” para agrupar por área.</p>
            </div>
          </details>
        </motion.div>
      )}
      </AnimatePresence>
      {canEdit && !editing && naoSalvas > 0 && (
        <p className="text-[13px] text-[var(--text-muted)]">{naoSalvas} {naoSalvas === 1 ? 'mesa está' : 'mesas estão'} em posição automática (ainda não salva). Toque em “Editar planta” para arrumar e salvar.</p>
      )}

      <div className="overflow-auto rounded-[18px] border border-[var(--border)] max-h-[70vh]">
        <div
          ref={mapRef}
          className="relative w-full aspect-[16/10] min-h-[280px] bg-[var(--surface-2)]"
          style={{ minWidth: largura, backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
        >
          {rotulos.filter((r) => (areaSel === 'todas' || r.area === areaSel) && visiveis.some((t) => (t.area ?? '') === r.area)).map((r) => (
            <span key={r.area} className="pointer-events-none absolute -translate-y-full text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]" style={{ left: `${r.x}%`, top: `calc(${r.y}% - 24px)` }}>{r.area}</span>
          ))}
          {visiveis.map((t) => pin(t))}
          {visiveis.length === 0 && (
            <div className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-[var(--text-muted)]">
              {tables.length === 0 ? 'Esta loja ainda não tem mesas cadastradas.' : filtrarOcupadas ? 'Nenhuma mesa ocupada agora. Desligue “Só ocupadas” para ver todas.' : 'Nenhuma mesa nesta área.'}
            </div>
          )}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-muted)]" aria-label="Legenda">
        {LEGENDA.map((l) => <li key={l.texto} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: l.cor }} />{l.texto}</li>)}
      </ul>
    </div>
  );
};
