'use client';
import React, { createContext, useContext } from 'react';
import type { EventoNotificacao } from '@/lib/notificacoes';
import type { LocalPreparo } from '@/lib/locaisPreparo';
import type { DestinoAviso } from '@/lib/avisoDestino';

export interface NotificacoesValor {
  counts: { tables: number; kitchen: number; bar: number };
  porLocal: Record<string, number>;
  locais: LocalPreparo[];
  eventos: EventoNotificacao[];
  naoLidos: number;
  marcarLidos: (ids?: string[]) => void;
  pausado: boolean;
  /** Abre a tela do aviso; false se a pessoa não tem acesso à Administração. */
  abrirDestino: (d: DestinoAviso) => boolean;
  podeAbrirDestino: (d: DestinoAviso) => boolean;
}
const VAZIO: NotificacoesValor = { counts: { tables: 0, kitchen: 0, bar: 0 }, porLocal: {}, locais: [], eventos: [], naoLidos: 0, marcarLidos: () => {}, pausado: false, abrirDestino: () => false, podeAbrirDestino: () => false };
const Ctx = createContext<NotificacoesValor>(VAZIO);
export const NotificacoesProvider = Ctx.Provider;
export const useNotificacoes = () => useContext(Ctx);
