'use client';
import React, { createContext, useContext } from 'react';
import type { EventoNotificacao } from '@/lib/notificacoes';
import type { LocalPreparo } from '@/lib/locaisPreparo';

export interface NotificacoesValor {
  counts: { tables: number; kitchen: number; bar: number };
  porLocal: Record<string, number>;
  locais: LocalPreparo[];
  eventos: EventoNotificacao[];
  naoLidos: number;
  marcarLidos: (ids?: string[]) => void;
  pausado: boolean;
}
const VAZIO: NotificacoesValor = { counts: { tables: 0, kitchen: 0, bar: 0 }, porLocal: {}, locais: [], eventos: [], naoLidos: 0, marcarLidos: () => {}, pausado: false };
const Ctx = createContext<NotificacoesValor>(VAZIO);
export const NotificacoesProvider = Ctx.Provider;
export const useNotificacoes = () => useContext(Ctx);
