'use client';
// Gestão de cupons de desconto (migration 142/143/144, 2026-10-03)
// CRUD simples: listar, criar, editar (toggle ativo), excluir.
// Mesmo padrão visual das outras telas de Administração.
import React, { useState, useEffect } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Ticket, AlertCircle } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { toast } from '@/components/Toast';
import { fetchCoupons, createCoupon, updateCoupon, deleteCoupon, type DiscountCoupon } from '@/lib/api';
import { formatBRL } from '@/lib/calc';

const CouponManagementView: React.FC<{ storeId: string }> = ({ storeId }) => {
  const [coupons, setCoupons] = useState<DiscountCoupon[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  // Form state
  const [fCode, setFCode] = useState('');
  const [fType, setFType] = useState<'percent' | 'fixed'>('percent');
  const [fValue, setFValue] = useState('');
  const [fMaxUses, setFMaxUses] = useState('');
  const [fMinOrder, setFMinOrder] = useState('');
  const [fExpires, setFExpires] = useState('');

  const load = async () => {
    setIsLoading(true);
    const data = await fetchCoupons(storeId);
    setCoupons(data);
    setIsLoading(false);
  };

  useEffect(() => { load(); }, [storeId]);

  const resetForm = () => {
    setFCode(''); setFType('percent'); setFValue('');
    setFMaxUses(''); setFMinOrder(''); setFExpires('');
    setShowForm(false);
  };

  const handleCreate = async () => {
    if (!fCode.trim() || !fValue) return toast.error('Preencha código e valor.');
    const valueNum = parseFloat(fValue.replace(',', '.'));
    if (isNaN(valueNum) || valueNum <= 0) return toast.error('Valor precisa ser maior que zero.');
    if (fType === 'percent' && valueNum > 100) return toast.error('Percentual máximo é 100%.');
    setIsSaving(true);
    const result = await createCoupon(storeId, {
      code: fCode,
      type: fType,
      value: valueNum,
      max_uses: fMaxUses ? parseInt(fMaxUses) : null,
      min_order_value: fMinOrder ? parseFloat(fMinOrder.replace(',', '.')) : null,
      expires_at: fExpires ? new Date(fExpires).toISOString() : null,
    });
    setIsSaving(false);
    if (result.success) {
      toast.success('Cupom criado!');
      resetForm();
      load();
    } else {
      toast.error(result.message || 'Erro ao criar cupom.');
    }
  };

  const handleToggleActive = async (coupon: DiscountCoupon) => {
    const result = await updateCoupon(coupon.id, { active: !coupon.active });
    if (result.success) load();
    else toast.error('Erro ao alterar cupom.');
  };

  const handleDelete = async (coupon: DiscountCoupon) => {
    if (!confirm(`Excluir cupom "${coupon.code}"?`)) return;
    const result = await deleteCoupon(coupon.id);
    if (result.success) { toast.success('Cupom excluído.'); load(); }
    else toast.error('Erro ao excluir.');
  };

  const formatValue = (c: DiscountCoupon) =>
    c.type === 'percent' ? `${c.value}%` : `R$ ${formatBRL(Number(c.value))}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-[17px] tracking-[-0.01em] text-[var(--text)]">Cupons de desconto</h3>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            Crie códigos de desconto pro cliente usar no checkout do cardápio digital.
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} aria-label="Novo cupom">
          <Plus size={18} /> Novo cupom
        </Button>
      </div>

      {showForm && (
        <div className="bg-[var(--surface)] rounded-[var(--r-lg)] shadow-[var(--shadow-sm)] p-5 space-y-4 border border-[var(--brand)]/20">
          <h4 className="font-semibold text-[15px] text-[var(--text)]">Criar cupom</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="Código" placeholder="Ex: SERTAO10" value={fCode} onChange={e => setFCode(e.target.value.toUpperCase())} />
            <div className="space-y-1.5">
              <label className="text-[13px] font-semibold text-[var(--text-muted)]">Tipo</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setFType('percent')}
                  className={`flex-1 h-10 rounded-full text-[14px] font-semibold u-motion u-press-sm ${fType === 'percent' ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}
                >
                  Percentual (%)
                </button>
                <button
                  type="button"
                  onClick={() => setFType('fixed')}
                  className={`flex-1 h-10 rounded-full text-[14px] font-semibold u-motion u-press-sm ${fType === 'fixed' ? 'bg-[var(--brand-fill)] text-white' : 'bg-[var(--surface-2)] text-[var(--text)]'}`}
                >
                  Valor fixo (R$)
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Input
              label={`Valor (${fType === 'percent' ? '%' : 'R$'})`}
              type="number" step={fType === 'percent' ? '1' : '0.01'} min="0"
              max={fType === 'percent' ? '100' : undefined}
              placeholder={fType === 'percent' ? 'Ex: 10' : 'Ex: 20.00'}
              value={fValue} onChange={e => setFValue(e.target.value)}
            />
            <Input label="Máx. de usos (opcional)" type="number" min="1" placeholder="Ilimitado" value={fMaxUses} onChange={e => setFMaxUses(e.target.value)} />
            <Input label="Pedido mínimo R$ (opcional)" type="number" step="0.01" min="0" placeholder="Sem mínimo" value={fMinOrder} onChange={e => setFMinOrder(e.target.value)} />
          </div>
          <Input label="Validade (opcional)" type="date" value={fExpires} onChange={e => setFExpires(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={resetForm}>Cancelar</Button>
            <Button onClick={handleCreate} isLoading={isSaving}>Criar cupom</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-[var(--text-muted)]">Carregando...</div>
      ) : coupons.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <Ticket size={40} className="mx-auto mb-3 opacity-30" />
          <p>Nenhum cupom cadastrado ainda.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {coupons.map(c => (
            <div key={c.id} className={`flex items-center gap-4 p-4 rounded-[var(--r-lg)] bg-[var(--surface)] shadow-[var(--shadow-sm)] ${!c.active ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-[16px] text-[var(--text)] tracking-wide">{c.code}</span>
                  <span className="text-[12px] px-2 py-0.5 rounded-full bg-[var(--brand-soft)] text-[var(--brand)] font-semibold">
                    {formatValue(c)}
                  </span>
                  {!c.active && (
                    <span className="text-[12px] px-2 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)] font-semibold">
                      Inativo
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
                  {c.uses_count} uso{c.uses_count !== 1 ? 's' : ''}{c.max_uses != null ? ` / ${c.max_uses} máx` : ''}
                  {c.min_order_value != null && ` · Mín. R$ ${formatBRL(Number(c.min_order_value))}`}
                  {c.expires_at && ` · Vence ${new Date(c.expires_at).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => handleToggleActive(c)}
                  className="text-[var(--text-muted)] hover:text-[var(--brand)] u-motion"
                  title={c.active ? 'Desativar' : 'Ativar'}
                >
                  {c.active ? <ToggleRight size={24} className="text-[var(--ok)]" /> : <ToggleLeft size={24} />}
                </button>
                <button
                  onClick={() => handleDelete(c)}
                  className="text-[var(--text-muted)] hover:text-[var(--err)] u-motion"
                  title="Excluir"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default CouponManagementView;