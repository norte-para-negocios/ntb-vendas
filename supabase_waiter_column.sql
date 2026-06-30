-- ⚠️ RODE ESTE SCRIPT NO SQL EDITOR DO SUPABASE PARA CORRIGIR O ERRO

-- 1. Adiciona a coluna que indica se o garçom foi chamado na mesa (se não existir)
ALTER TABLE tables 
ADD COLUMN IF NOT EXISTS waiter_requested BOOLEAN DEFAULT false;

-- 2. Atualiza a coluna current_host_name para permitir NULL (necessário para fechar a mesa)
ALTER TABLE tables 
ALTER COLUMN current_host_name DROP NOT NULL;

-- 3. Notificar o PostgREST para recarregar o schema cache
NOTIFY pgrst, 'reload schema';