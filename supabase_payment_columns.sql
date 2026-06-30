-- Adicionar colunas de pagamento na tabela orders
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_method') THEN
        ALTER TABLE orders ADD COLUMN payment_method TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='payment_details') THEN
        ALTER TABLE orders ADD COLUMN payment_details JSONB;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
