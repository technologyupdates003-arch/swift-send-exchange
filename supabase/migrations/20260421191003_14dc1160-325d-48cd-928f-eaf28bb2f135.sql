-- VirtualPay transactions: card funding, bank transfer funding, and bank payouts
CREATE TABLE IF NOT EXISTS public.virtualpay_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reference text NOT NULL UNIQUE,
  provider_reference text,
  flow text NOT NULL CHECK (flow IN ('card', 'bank_transfer', 'payout')),
  amount numeric NOT NULL CHECK (amount > 0),
  currency public.wallet_currency NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
  checkout_url text,
  bank_details jsonb,
  bank_account_id uuid REFERENCES public.bank_accounts(id) ON DELETE SET NULL,
  withdrawal_id uuid,
  provider_response jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_vp_user ON public.virtualpay_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_vp_reference ON public.virtualpay_transactions(reference);
CREATE INDEX IF NOT EXISTS idx_vp_status ON public.virtualpay_transactions(status);

ALTER TABLE public.virtualpay_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own virtualpay tx" ON public.virtualpay_transactions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins view all virtualpay tx" ON public.virtualpay_transactions
  FOR SELECT USING (public.is_admin_any());

CREATE TRIGGER vp_tx_updated_at BEFORE UPDATE ON public.virtualpay_transactions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
