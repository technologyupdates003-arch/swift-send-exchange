DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT id, user_id, reference, amount
    FROM public.mpesa_stk_requests
    WHERE status = 'failed'
      AND provider_response->>'failed_code' = '0'
      AND provider_response->>'mpesa_reference' IS NOT NULL
  LOOP
    UPDATE public.mpesa_stk_requests
       SET status='completed', completed_at=now()
     WHERE id = r.id AND status='failed';
    PERFORM public.fund_wallet(r.user_id, 'KES'::wallet_currency, r.amount::numeric, 'mpesa_stk', r.reference);
  END LOOP;
END $$;