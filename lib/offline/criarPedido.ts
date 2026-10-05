import { supabase } from '../supabaseClient';

type Resultado = { success: boolean; order_id?: string; message?: string; duplicado?: boolean };

// Chama a create_order_v3 (idempotente por p_client_request_id: o mesmo pedido reenviado devolve a resposta guardada em vez
// de criar outro). Se o banco ainda não tem a migration 162 (PGRST202), cai na create_order_secure sem o id.
// Rede/timeout PROPAGA (quem chama decide enfileirar); regra de negócio volta em { success: false }.
export async function chamarCriarPedido(payload: Record<string, unknown>): Promise<Resultado> {
  const { data, error } = await supabase.rpc('create_order_v3', payload);
  if (error && (error as { code?: string }).code === 'PGRST202') {
    const { p_client_request_id: _ignorado, ...semId } = payload;
    const r = await supabase.rpc('create_order_secure', semId);
    if (r.error) throw r.error;
    return (r.data ?? { success: false, message: 'Resposta vazia.' }) as Resultado;
  }
  if (error) throw error;
  return (data ?? { success: false, message: 'Resposta vazia.' }) as Resultado;
}
