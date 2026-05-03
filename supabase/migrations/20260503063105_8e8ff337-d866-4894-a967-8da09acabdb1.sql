REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_transaction_created() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_platform_wallet(wallet_currency, numeric, text, text, text, uuid, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fund_wallet(uuid, wallet_currency, numeric, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fund_wallet(uuid, wallet_currency, numeric, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_funds_by_wallet(text, numeric, text, text, wallet_currency) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exchange_currency(wallet_currency, wallet_currency, numeric, text) TO authenticated;