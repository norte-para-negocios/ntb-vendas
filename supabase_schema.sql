-- ⚠️ IMPORTANTE: 
-- Rode este script no SQL Editor do Supabase para corrigir o erro de coluna ausente.

-- 1. Garante que a tabela orders tem as colunas novas
DO $$
BEGIN
    -- Adicionar customer_name se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_name') THEN
        ALTER TABLE orders ADD COLUMN customer_name TEXT;
    END IF;

    -- Adicionar order_type se não existir
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_type') THEN
        ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'table';
    END IF;

    -- Permitir table_id nulo (para pedidos de balcão)
    ALTER TABLE orders ALTER COLUMN table_id DROP NOT NULL;
END $$;

-- 2. Atualizar permissões (garantia)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Access" ON orders;
CREATE POLICY "Public Access" ON orders FOR ALL USING (true) WITH CHECK (true);

-- 3. FORÇAR RECARREGAMENTO DO CACHE DO ESQUEMA (PostgREST)
-- Isso corrige o erro "Could not find the '...' column in the schema cache"
NOTIFY pgrst, 'reload schema';