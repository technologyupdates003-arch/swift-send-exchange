import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ALL_CURRENCIES } from "@/lib/format";

const sb = supabase as any;

interface Config { key: string; value: any; description: string; }
interface Rate { id: string; from_currency: string; to_currency: string; rate: number; }

export default function SystemConfig() {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [rates, setRates] = useState<Rate[]>([]);
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("KES");
  const [rateVal, setRateVal] = useState("");

  const load = async () => {
    const [c, r] = await Promise.all([
      sb.from("app_config").select("*").order("key"),
      sb.from("exchange_rates").select("*").order("from_currency"),
    ]);
    setConfigs(c.data ?? []); setRates(r.data ?? []);
  };
  useEffect(() => { load(); }, []);

  const saveConfig = async (key: string, value: any) => {
    const { error } = await sb.from("app_config").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    if (error) return toast.error(error.message);
    toast.success(`Saved ${key}`); load();
  };

  const upsertRate = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = parseFloat(rateVal);
    if (!r || r <= 0) return toast.error("Invalid rate");
    if (from === to) return toast.error("Pick different currencies");
    const existing = rates.find((x) => x.from_currency === from && x.to_currency === to);
    if (existing) {
      await sb.from("exchange_rates").update({ rate: r, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await sb.from("exchange_rates").insert({ from_currency: from, to_currency: to, rate: r });
    }
    toast.success(`${from} → ${to} = ${r}`); setRateVal(""); load();
  };

  const fees = configs.filter((c) => c.key.startsWith("fee_"));
  const fraud = configs.filter((c) => c.key.startsWith("fraud_"));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Fees & commissions</CardTitle><CardDescription>Percent + flat fee per transaction type.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {fees.map((c) => <FeeRow key={c.key} config={c} onSave={saveConfig} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Fraud thresholds</CardTitle><CardDescription>JSON config for risk detection.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {fraud.map((c) => <JsonRow key={c.key} config={c} onSave={saveConfig} />)}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Exchange rates</CardTitle><CardDescription>Used for currency exchange.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={upsertRate} className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="rounded-md border bg-background p-2 text-sm">
              {ALL_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="rounded-md border bg-background p-2 text-sm">
              {ALL_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
            </select>
            <Input type="number" step="0.000001" placeholder="Rate" value={rateVal} onChange={(e) => setRateVal(e.target.value)} />
            <Button type="submit">Save</Button>
          </form>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
            {rates.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded border p-2">
                <span>{r.from_currency} → {r.to_currency}</span>
                <span className="font-mono">{r.rate}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FeeRow({ config, onSave }: { config: Config; onSave: (k: string, v: any) => void }) {
  const [percent, setPercent] = useState(String(config.value?.percent ?? 0));
  const [flat, setFlat] = useState(String(config.value?.flat ?? 0));
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{config.key}</p>
      <p className="text-xs text-muted-foreground mb-2">{config.description}</p>
      <div className="grid grid-cols-3 gap-2">
        <div><Label className="text-xs">Percent</Label><Input type="number" step="0.01" value={percent} onChange={(e) => setPercent(e.target.value)} /></div>
        <div><Label className="text-xs">Flat</Label><Input type="number" step="0.01" value={flat} onChange={(e) => setFlat(e.target.value)} /></div>
        <div className="flex items-end"><Button size="sm" className="w-full" onClick={() => onSave(config.key, { percent: parseFloat(percent), flat: parseFloat(flat) })}>Save</Button></div>
      </div>
    </div>
  );
}

function JsonRow({ config, onSave }: { config: Config; onSave: (k: string, v: any) => void }) {
  const [raw, setRaw] = useState(JSON.stringify(config.value, null, 2));
  const save = () => {
    try { onSave(config.key, JSON.parse(raw)); }
    catch { toast.error("Invalid JSON"); }
  };
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{config.key}</p>
      <p className="text-xs text-muted-foreground mb-2">{config.description}</p>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)}
        className="w-full rounded-md border bg-background p-2 text-xs font-mono" rows={3} />
      <Button size="sm" className="mt-2" onClick={save}>Save</Button>
    </div>
  );
}
