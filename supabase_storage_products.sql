-- ⚠️ RODE ESTE SCRIPT NO SQL EDITOR DO SUPABASE
-- Criação do Bucket de Imagens de Produtos e Políticas de Segurança

-- 1. Criar o Bucket 'product-images' (se não existir)
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Configurar Políticas de Segurança (RLS) para o Storage

-- Permitir acesso PÚBLICO para visualizar imagens (SELECT)
DROP POLICY IF EXISTS "Public View Products" ON storage.objects;
CREATE POLICY "Public View Products" ON storage.objects
  FOR SELECT USING ( bucket_id = 'product-images' );

-- Permitir UPLOAD de imagens para qualquer pessoa (no MVP)
-- Em produção, restrinja isso apenas a usuários autenticados (role 'authenticated')
DROP POLICY IF EXISTS "Public Upload Products" ON storage.objects;
CREATE POLICY "Public Upload Products" ON storage.objects
  FOR INSERT WITH CHECK ( bucket_id = 'product-images' );

-- Permitir UPDATE (substituir imagens)
DROP POLICY IF EXISTS "Public Update Products" ON storage.objects;
CREATE POLICY "Public Update Products" ON storage.objects
  FOR UPDATE USING ( bucket_id = 'product-images' );
