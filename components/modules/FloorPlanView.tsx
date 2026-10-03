'use client';
// Planta de mesas (floor plan, 2026-10-03). Mesa = botão posicionado em % do mapa.
// Modo edição (gerente/dono): arrasta pra posicionar; mesas sem posição ficam na bandeja
// e entram no mapa ao tocar nelas e depois no ponto desejado.
import React, { useRef, useState } from 'react';
import { Pencil, Check, X } from 'lucide-react';
import type { Table } from '@/types';

export interface FloorPlanTableInfo {
  dotColor: string;
  statusLabel: string;
  inJurisdiction: boolean;
  blocked: boolean;
}

interface Props {
  tables: Table[];
  info: (table: Table) => FloorPlanTableInfo;
  onOpen: (table: Table) => void;
  canEdit: boolean;
  onMove: (tableId: string, x: number | null, y: number | null) => void;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

export const FloorPlanView: React.FC<Props> = ({ tables, info, onOpen, canEdit, onMove }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null); // mesa da bandeja escolhida pra posicionar
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  const placed = tables.filter((t) => t.floor_x != null && t.floor_y != null);
  const tray = tables.filter((t) => t.floor_x == null || t.floor_y == null);

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
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const p = pointToPercent(e.clientX, e.clientY);
    const r = mapRef.current?.getBoundingClientRect();
    const fora = !!r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
    setDragPos(null);
    if (!d.moved) return;
    if (fora) onMove(d.id, null, null); // soltou fora do mapa = tira da planta
    else if (p) onMove(d.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100);
  };

  const placeOnMap = (e: React.MouseEvent) => {
    if (!editing || !picked) return;
    if ((e.target as HTMLElement).closest('[data-mesa]')) return;
    const p = pointToPercent(e.clientX, e.clientY);
    if (!p) return;
    onMove(picked, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100);
    setPicked(null);
  };

  const Pin = ({ t }: { t: Table }) => {
    const i = info(t);
    const pos = dragPos?.id === t.id ? dragPos : { x: Number(t.floor_x), y: Number(t.floor_y) };
    return (
      <button
        type="button"
        data-mesa
        onPointerDown={(e) => onPointerDown(e, t)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() => { if (!editing && i.inJurisdiction && !i.blocked) onOpen(t); }}
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, touchAction: editing ? 'none' : 'auto' }}
        className={`absolute -translate-x-1/2 -translate-y-1/2 min-w-[44px] h-11 px-2 rounded-xl border bg-[var(--surface)] shadow-[var(--shadow-sm)] flex flex-col items-center justify-center text-[13px] font-semibold text-[var(--text)] ${
          editing ? 'cursor-grab ring-1 ring-dashed ring-[var(--brand)]' : i.inJurisdiction && !i.blocked ? 'hover:shadow-md' : 'opacity-50'
        }`}
        aria-label={`Mesa ${t.number}, ${i.statusLabel}`}
        title={`Mesa ${t.number} · ${i.statusLabel}`}
      >
        <span className="leading-none">{t.number}</span>
        <span className="mt-1 h-1.5 w-1.5 rounded-full" style={{ background: i.dotColor }} />
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-[var(--text-muted)]">
            {editing
              ? picked
                ? `Toque no mapa para colocar a mesa ${tables.find((t) => t.id === picked)?.number}.`
                : 'Arraste as mesas para posicionar. Toque numa mesa da bandeja para colocá-la no mapa.'
              : `${placed.length} de ${tables.length} mesas posicionadas.`}
          </p>
          <button
            type="button"
            onClick={() => { setEditing((v) => !v); setPicked(null); }}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full bg-[var(--surface-2)] text-[13px] font-semibold text-[var(--text)] u-press"
          >
            {editing ? <><Check size={14} /> Concluir</> : <><Pencil size={14} /> Editar planta</>}
          </button>
        </div>
      )}

      <div
        ref={mapRef}
        onClick={placeOnMap}
        className="relative w-full aspect-[16/10] min-h-[280px] rounded-[18px] border border-[var(--border)] bg-[var(--surface-2)] overflow-hidden"
        style={{ backgroundImage: 'radial-gradient(var(--border) 1px, transparent 1px)', backgroundSize: '24px 24px' }}
      >
        {placed.map((t) => <Pin key={t.id} t={t} />)}
        {placed.length === 0 && (
          <div className="absolute inset-0 grid place-items-center text-sm text-[var(--text-muted)] px-6 text-center">
            {canEdit ? 'Nenhuma mesa no mapa ainda. Toque em "Editar planta" e posicione as mesas.' : 'A planta desta loja ainda não foi montada.'}
          </div>
        )}
      </div>

      {editing && tray.length > 0 && (
        <div>
          <h4 className="eyebrow mb-2">Sem posição ({tray.length})</h4>
          <div className="flex flex-wrap gap-2">
            {tray.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setPicked((p) => (p === t.id ? null : t.id))}
                className={`h-9 min-w-[44px] px-3 rounded-xl border text-[13px] font-semibold u-press ${picked === t.id ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)]'}`}
              >
                {t.number}
              </button>
            ))}
          </div>
        </div>
      )}

      {editing && placed.length > 0 && (
        <p className="text-[12px] text-[var(--text-muted)] flex items-center gap-1">
          <X size={12} /> Para tirar uma mesa do mapa, arraste-a para fora do mapa e solte.
        </p>
      )}
    </div>
  );
};
