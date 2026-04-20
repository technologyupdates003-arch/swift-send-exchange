-- Ensure execute grants and refresh PostgREST schema cache so RPCs are reachable
GRANT EXECUTE ON FUNCTION public.set_transaction_pin(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_pin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_transaction_pin(text) TO authenticated;
NOTIFY pgrst, 'reload schema';