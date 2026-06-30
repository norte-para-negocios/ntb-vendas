-- ⚠️ RODE ESTE SCRIPT NO SQL EDITOR DO SUPABASE
-- Este script configura o Realtime e as permissões de acesso.

-- 1. Habilitar Realtime nas tabelas críticas
-- O 'supabase_realtime' é a publicação padrão que envia eventos para o frontend.
DO $$
BEGIN
  -- Adicionar 'orders' ao Realtime
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;

  -- Adicionar 'order_items' ao Realtime (Fundamental para atualizar quando itens são adicionados)
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'order_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
  END IF;

  -- Adicionar 'tables' ao Realtime (Para status das mesas)
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'tables') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;
END $$;

-- 2. Garantir Políticas de Segurança (RLS)
-- Sem isso, o frontend conecta no socket mas não recebe os dados por falta de permissão.

-- Habilitar RLS nas tabelas (se ainda não estiver)
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

-- Criar políticas públicas (Permite leitura/escrita para todos no MVP)
-- Em produção, você restringiria isso, mas para o MVP funcionar liso:

-- ORDERS
DROP POLICY IF EXISTS "Enable all for orders" ON orders;
CREATE POLICY "Enable all for orders" ON orders FOR ALL USING (true) WITH CHECK (true);

-- ORDER ITEMS
DROP POLICY IF EXISTS "Enable all for order_items" ON order_items;
CREATE POLICY "Enable all for order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);

-- TABLES
DROP POLICY IF EXISTS "Enable all for tables" ON tables;
CREATE POLICY "Enable all for tables" ON tables FOR ALL USING (true) WITH CHECK (true);

-- PRODUCTS & CATEGORIES & STORES (Leitura pública necessária para o cliente)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read products" ON products;
CREATE POLICY "Public read products" ON products FOR SELECT USING (true);
-- Se precisar criar/editar produtos via admin:
CREATE POLICY "Enable all products" ON products FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read categories" ON categories;
CREATE POLICY "Enable all categories" ON categories FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read stores" ON stores;
CREATE POLICY "Enable all stores" ON stores FOR ALL USING (true) WITH CHECK (true);

-- 3. Correção de Colunas (Prevenção)
-- Garante que as colunas usadas no frontend existam
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_name') THEN
        ALTER TABLE orders ADD COLUMN customer_name TEXT;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_type') THEN
        ALTER TABLE orders ADD COLUMN order_type TEXT DEFAULT 'table';
    END IF;
END $$;

-- 4. Notificar PostgREST para recarregar o schema cache
NOTIFY pgrst, 'reload schema';