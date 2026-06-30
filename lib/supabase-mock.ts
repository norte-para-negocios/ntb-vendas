// Mock do cliente Supabase para testes locais (sem conexão real)
const noopChannel = () => {
  const ch: any = {
    on: (..._args: any[]) => ch,
    subscribe: (cb?: (status: string) => void) => { cb?.('SUBSCRIBED'); return ch; },
    unsubscribe: () => Promise.resolve('ok' as const),
  };
  return ch;
};

export const supabase = {
  channel: (_name: string) => noopChannel(),
  removeChannel: (_ch: any) => Promise.resolve('ok' as const),
  removeAllChannels: () => Promise.resolve([]),
} as any;
