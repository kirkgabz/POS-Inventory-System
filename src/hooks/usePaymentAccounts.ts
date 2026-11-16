import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { PaymentAccount } from '../lib/types';

/** Store payment accounts (e-wallets, banks/cards), kept live via Realtime. */
export function usePaymentAccounts(includeInactive = false) {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let q = supabase.from('payment_accounts').select('*').order('created_at');
    if (!includeInactive) q = q.eq('is_active', true);
    const { data } = await q;
    setAccounts((data as PaymentAccount[]) ?? []);
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`payacc-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_accounts' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  return { accounts, setAccounts, loading, reload: load };
}
