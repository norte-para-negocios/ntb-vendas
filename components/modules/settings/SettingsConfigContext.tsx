'use client';
// Fonte única do config da loja para as telas de ajustes (Configurações e Regras do caixa):
// salvar na hora, otimista, volta ao valor salvo se falhar e oferece "Desfazer".
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { updateStoreConfig } from '@/lib/api';
import { aplicarPatch } from '@/lib/configPatch';
import { toast } from '@/components/Toast';
import type { Store } from '@/types';

type Cfg = Record<string, unknown>;
interface Ctx {
  config: Cfg | undefined;
  salvar: (patch: Cfg, rotulo: string, opts?: { semDesfazer?: boolean; mensagem?: string }) => Promise<boolean>;
  /** Para telas que gravam por outro caminho (ex.: cor de destaque): só atualiza o estado local e o pai. */
  aplicarConfig: (novo: Cfg) => void;
}
const SettingsCtx = createContext<Ctx | null>(null);

export const useSettingsConfig = (): Ctx => {
  const c = useContext(SettingsCtx);
  if (!c) throw new Error('useSettingsConfig fora do SettingsConfigProvider');
  return c;
};

export const SettingsConfigProvider: React.FC<{ store: Store; onStoreUpdate?: (s: Store) => void; children: React.ReactNode }> = ({ store, onStoreUpdate, children }) => {
  const [config, setConfig] = useState<Cfg | undefined>(store.config as Cfg | undefined);
  const ref = useRef(config);
  ref.current = config;
  const storeRef = useRef(store);
  storeRef.current = store;
  const onUpdateRef = useRef(onStoreUpdate);
  onUpdateRef.current = onStoreUpdate;

  // a loja que vem do pai é a fonte da verdade; resincroniza se ela mudar por fora
  useEffect(() => { setConfig(store.config as Cfg | undefined); ref.current = store.config as Cfg | undefined; }, [store.config]);

  const aplicarConfig = useCallback((novo: Cfg) => {
    ref.current = novo;
    setConfig(novo);
    onUpdateRef.current?.({ ...storeRef.current, config: novo as never });
  }, []);

  const salvar = useCallback<Ctx['salvar']>(async (patch, rotulo, opts) => {
    const anterior = ref.current;
    const novo = aplicarPatch(anterior, patch);
    try {
      await updateStoreConfig(storeRef.current.id, novo);
      aplicarConfig(novo);
      if (!opts?.semDesfazer) {
        // volta só as chaves que este salvar tocou (chave que não existia volta a não existir)
        const volta: Cfg = {};
        Object.keys(patch).forEach((k) => { volta[k] = anterior ? anterior[k] : undefined; });
        toast.undo(opts?.mensagem ?? `${rotulo} atualizado.`, 'Desfazer', async () => { await salvar(volta, rotulo, { semDesfazer: true }); });
      }
      return true;
    } catch (e) {
      console.error('salvar configuração falhou:', rotulo, e);
      toast.error(`Erro ao atualizar ${rotulo.toLowerCase()}.`);
      return false;
    }
  }, [aplicarConfig]);

  const value = useMemo(() => ({ config, salvar, aplicarConfig }), [config, salvar, aplicarConfig]);
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
};

/** Valor + setter otimista. Se o salvar falha, o valor volta ao que estava salvo. */
export function useSetting<T>(chave: string, padrao: T, rotulo: string, ler?: (bruto: unknown) => T): [T, (novo: T) => Promise<void>] {
  const { config, salvar } = useSettingsConfig();
  const [otimista, setOtimista] = useState<{ v: T } | null>(null);
  const bruto = config?.[chave];
  const atual = ler ? ler(bruto) : ((bruto ?? padrao) as T);
  const valor = otimista ? otimista.v : atual;
  const definir = useCallback(async (novo: T) => {
    setOtimista({ v: novo });
    await salvar({ [chave]: novo }, rotulo);
    setOtimista(null);
  }, [chave, rotulo, salvar]);
  return [valor, definir];
}
