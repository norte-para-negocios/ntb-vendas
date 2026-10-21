'use client';
// Tela de Mesas neste computador (21/10/2026): só o aparelho marcado mostra "Mesas · <loja>" na tela de entrada.
// Fica guardado no próprio aparelho (lib/computadorMesas.ts); cada computador e celular tem a sua escolha.
import React, { useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { Button, Card } from '@/components/ui';
import { toast } from '@/components/Toast';
import { confirm } from '@/components/ConfirmDialog';
import { lerComputadorMesas, salvarComputadorMesas, type ComputadorMesas } from '@/lib/computadorMesas';
import type { Store } from '@/types';

export const ComputadorMesasCard: React.FC<{ store: Store; quemConfigura?: string }> = ({ store, quemConfigura }) => {
  const [atual, setAtual] = useState<ComputadorMesas | null>(null);
  useEffect(() => {
    setAtual(lerComputadorMesas());
    const aoMudar = () => setAtual(lerComputadorMesas());
    window.addEventListener('ntb-computador-mesas', aoMudar);
    return () => window.removeEventListener('ntb-computador-mesas', aoMudar);
  }, []);

  const ligar = async () => {
    if (atual && atual.storeId !== store.id) {
      const ok = await confirm({
        title: `Trocar para ${store.name}?`,
        message: `Este computador abre hoje as Mesas de ${atual.storeName || 'outra loja'}. Depois da troca, o botão Mesas da tela de entrada abre ${store.name}.`,
        confirmLabel: 'Trocar',
      });
      if (!ok) return;
    }
    salvarComputadorMesas({ storeId: store.id, storeName: store.name, definidoPor: quemConfigura ?? '', em: new Date().toISOString() });
    toast.success(`Este computador agora abre as Mesas de ${store.name}.`);
  };
  const desligar = () => {
    salvarComputadorMesas(null);
    toast.success('O botão Mesas saiu da tela de entrada deste computador.');
  };

  const daqui = atual?.storeId === store.id;
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-start gap-3">
        <LayoutDashboard size={20} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold text-[var(--text)]">Tela de Mesas neste computador</p>
          <p className="text-[13px] text-[var(--text-muted)] mt-0.5">
            {daqui
              ? <>Este computador mostra o botão <span className="font-medium text-[var(--text)]">Mesas · {store.name}</span> na tela de entrada. Qualquer pessoa entra só nas mesas e confirma cada pedido com a própria senha.</>
              : atual
                ? <>Este computador abre as Mesas de <span className="font-medium text-[var(--text)]">{atual.storeName || 'outra loja'}</span>.</>
                : <>Use no computador ou celular do salão. Só os aparelhos marcados aqui mostram o botão Mesas na tela de entrada, com o nome da loja.</>}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {!daqui && <Button size="sm" onClick={ligar}>{atual ? `Trocar para ${store.name}` : `Usar este computador como Mesas da ${store.name}`}</Button>}
        {atual && <Button size="sm" variant="secondary" onClick={desligar}>Tirar o botão Mesas deste computador</Button>}
      </div>
    </Card>
  );
};
