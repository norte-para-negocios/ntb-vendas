'use client';
// Preço por horário / happy hour (2026-10-04, migration 153). Regra: produto ou categoria custa R$ X (ou -Y%)
// em certos dias e horários. O servidor cobra o preço vigente; o cardápio mostra o mesmo preço.
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Clock } from 'lucide-react';
import { Button, Input, Card } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchMenu, fetchPriceSchedules, savePriceSchedule, deletePriceSchedule } from '@/lib/api';
import { formatBRL } from '@/lib/calc';
import type { PriceSchedule } from '@/lib/priceSchedule';
import type { Category, Product } from '@/types';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface Form {
  id: string | null;
  name: string;
  alvo: 'product' | 'category';
  alvoId: string;
  tipo: 'discount' | 'price';
  valor: string;
  days: number[];
  from: string;
  until: string;
  active: boolean;
}
const FORM_VAZIO: Form = { id: null, name: '', alvo: 'category', alvoId: '', tipo: 'discount', valor: '', days: [], from: '17:00', until: '19:00', active: true };

const resumoDias = (days: number[] | null) => (!days || days.length === 0 || days.length === 7 ? 'todos os dias' : days.slice().sort().map((d) => DIAS[d]).join(', '));

export const PriceSchedulesView: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [schedules, setSchedules] = useState<PriceSchedule[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const carregar = useCallback(async () => {
    const [s, menu] = await Promise.all([fetchPriceSchedules(storeId), fetchMenu(storeId, false, true)]);
    setSchedules(s);
    setProducts(menu.products);
    setCategories(menu.categories);
  }, [storeId]);
  useEffect(() => { carregar(); }, [carregar]);

  const nomeAlvo = (s: PriceSchedule) =>
    s.product_id ? products.find((p) => p.id === s.product_id)?.name ?? 'Produto' : categories.find((c) => c.id === s.category_id)?.name ?? 'Categoria';

  const abrirEdicao = (s: PriceSchedule) =>
    setForm({
      id: s.id, name: s.name, alvo: s.product_id ? 'product' : 'category', alvoId: (s.product_id ?? s.category_id) ?? '',
      tipo: s.price != null ? 'price' : 'discount', valor: String(s.price ?? s.discount_percent ?? ''),
      days: s.days ?? [], from: s.time_from.slice(0, 5), until: s.time_until.slice(0, 5), active: s.active,
    });

  const salvar = async () => {
    if (!form) return;
    const valor = Number(String(form.valor).replace(',', '.'));
    if (!form.name.trim()) { toast.error('Dê um nome à regra (ex.: Happy hour).'); return; }
    if (!form.alvoId) { toast.error('Escolha o produto ou a categoria.'); return; }
    if (!(valor > 0) || (form.tipo === 'discount' && valor > 100)) { toast.error(form.tipo === 'discount' ? 'Desconto de 1 a 100%.' : 'Informe o preço.'); return; }
    if (form.from === form.until) { toast.error('Início e fim não podem ser iguais.'); return; }
    setSaving(true);
    const ok = await savePriceSchedule(storeId, form.id, {
      name: form.name.trim(),
      product_id: form.alvo === 'product' ? form.alvoId : null,
      category_id: form.alvo === 'category' ? form.alvoId : null,
      price: form.tipo === 'price' ? valor : null,
      discount_percent: form.tipo === 'discount' ? valor : null,
      days: form.days,
      time_from: form.from,
      time_until: form.until,
      active: form.active,
    });
    setSaving(false);
    if (!ok) { toast.error('Não consegui salvar a regra.'); return; }
    toast.success('Regra salva.');
    setForm(null);
    carregar();
  };

  const remover = async (s: PriceSchedule) => {
    if (!window.confirm(`Apagar a regra "${s.name}"?`)) return;
    if (await deletePriceSchedule(storeId, s.id)) { toast.success('Regra apagada.'); carregar(); } else toast.error('Não consegui apagar.');
  };

  const alternarAtiva = async (s: PriceSchedule) => {
    const ok = await savePriceSchedule(storeId, s.id, {
      name: s.name, product_id: s.product_id, category_id: s.category_id, price: s.price, discount_percent: s.discount_percent,
      days: s.days ?? [], time_from: s.time_from.slice(0, 5), time_until: s.time_until.slice(0, 5), active: !s.active,
    });
    if (ok) carregar(); else toast.error('Não consegui atualizar.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[17px] font-semibold text-[var(--text)]">Preço por horário</h3>
          <p className="text-[13px] text-[var(--text-muted)]">Happy hour automático: o preço muda sozinho nos dias e horários escolhidos, na venda e no cardápio. Se várias regras valerem ao mesmo tempo, vale o menor preço.</p>
        </div>
        <Button onClick={() => setForm({ ...FORM_VAZIO })}><Plus size={16} /> Nova regra</Button>
      </div>

      {schedules.length === 0 && !form && (
        <Card className="p-6 text-sm text-[var(--text-muted)] flex items-center gap-3"><Clock size={18} /> Nenhuma regra criada. Exemplo: Drinks com 30% de desconto de segunda a sexta, das 17h às 19h.</Card>
      )}

      <div className="space-y-2">
        {schedules.map((s) => (
          <Card key={s.id} className={`p-4 flex items-center justify-between gap-3 ${s.active ? '' : 'opacity-60'}`}>
            <button type="button" onClick={() => abrirEdicao(s)} className="text-left min-w-0 flex-1">
              <p className="text-[15px] font-semibold text-[var(--text)] truncate">{s.name} <span className="font-normal text-[var(--text-muted)]">· {nomeAlvo(s)}</span></p>
              <p className="text-[13px] text-[var(--text-muted)]">
                {s.price != null ? `R$ ${formatBRL(Number(s.price))}` : `${Number(s.discount_percent)}% de desconto`} · {resumoDias(s.days)} · {s.time_from.slice(0, 5)}–{s.time_until.slice(0, 5)}
              </p>
            </button>
            <button type="button" onClick={() => alternarAtiva(s)} role="switch" aria-checked={s.active} aria-label={`Regra ${s.name} ativa`}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${s.active ? 'bg-[var(--ok-fill)]' : 'bg-[var(--border)]'}`}>
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${s.active ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <button type="button" onClick={() => remover(s)} className="text-[var(--text-muted)] hover:text-[var(--err)] p-2" aria-label={`Apagar ${s.name}`}><Trash2 size={16} /></button>
          </Card>
        ))}
      </div>

      {form && (
        <Card className="p-5 space-y-4">
          <h4 className="text-[15px] font-semibold text-[var(--text)]">{form.id ? 'Editar regra' : 'Nova regra'}</h4>
          <Input placeholder="Nome (ex.: Happy hour)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" value={form.alvo}
              onChange={(e) => setForm({ ...form, alvo: e.target.value as Form['alvo'], alvoId: '' })} aria-label="Vale para">
              <option value="category">Uma categoria inteira</option>
              <option value="product">Um produto</option>
            </select>
            <select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" value={form.alvoId}
              onChange={(e) => setForm({ ...form, alvoId: e.target.value })} aria-label="Qual">
              <option value="">Escolha…</option>
              {form.alvo === 'category'
                ? categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)
                : products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select className="h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-[15px] text-[var(--text)]" value={form.tipo}
              onChange={(e) => setForm({ ...form, tipo: e.target.value as Form['tipo'] })} aria-label="Tipo de preço">
              <option value="discount">Desconto em %</option>
              <option value="price">Preço fixo em R$</option>
            </select>
            <Input inputMode="decimal" placeholder={form.tipo === 'discount' ? 'Ex.: 30' : 'Ex.: 12,90'} value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--text-muted)] mb-2">Dias (nenhum marcado = todos os dias)</p>
            <div className="flex flex-wrap gap-2">
              {DIAS.map((d, i) => (
                <button key={d} type="button" aria-pressed={form.days.includes(i)}
                  onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i] })}
                  className={`h-9 max-sm:h-11 min-w-[44px] px-3 rounded-full border text-[13px] font-semibold u-press ${form.days.includes(i) ? 'bg-[var(--brand)] text-white border-[var(--brand)]' : 'bg-[var(--surface)] text-[var(--text)] border-[var(--border)]'}`}>{d}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[13px] text-[var(--text-muted)]">Das<Input type="time" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label>
            <label className="text-[13px] text-[var(--text-muted)]">Até<Input type="time" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></label>
          </div>
          <p className="text-[12px] text-[var(--text-muted)]">Horário de Brasília/Bahia. Janela que passa da meia-noite (ex.: 22:00 até 02:00) vale no dia em que começa.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setForm(null)} disabled={saving}>Cancelar</Button>
            <Button onClick={salvar} isLoading={saving}>Salvar regra</Button>
          </div>
        </Card>
      )}
    </div>
  );
};
