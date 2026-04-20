-- Dedupe: keep wallet with highest balance (then oldest) per (user_id, currency)
WITH ranked AS (
  SELECT id,
    row_number() OVER (PARTITION BY user_id, currency ORDER BY balance DESC, created_at ASC) AS rn
  FROM public.wallets
)
DELETE FROM public.wallets w USING ranked r
WHERE w.id = r.id AND r.rn > 1;

-- Enforce one wallet per currency per user
ALTER TABLE public.wallets
  ADD CONSTRAINT wallets_user_currency_unique UNIQUE (user_id, currency);