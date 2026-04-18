import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase as sb } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ShieldCheck, Clock, CheckCircle2, XCircle } from "lucide-react";

const supabase = sb as any;

const schema = z.object({
  document_type: z.string().min(1, "Pick a document type"),
  document_number: z.string().trim().min(4, "Document number too short").max(50),
  date_of_birth: z.string().min(1, "Required"),
  address: z.string().trim().min(8, "Address too short").max(300),
});

interface Kyc { status: string; submitted_at: string; reviewed_at: string | null; document_type: string; }

export default function Kyc() {
  const { user } = useAuth();
  const [existing, setExisting] = useState<Kyc | null>(null);
  const [loading, setLoading] = useState(true);
  const [docType, setDocType] = useState("");
  const [docNum, setDocNum] = useState("");
  const [dob, setDob] = useState("");
  const [addr, setAddr] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("kyc_verifications").select("*").eq("user_id", user.id).maybeSingle().then(({ data }: any) => {
      if (data) setExisting(data);
      setLoading(false);
    });
  }, [user]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = schema.safeParse({ document_type: docType, document_number: docNum, date_of_birth: dob, address: addr });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    if (!user) return;
    setSubmitting(true);
    const { data, error } = await supabase.from("kyc_verifications").insert({
      user_id: user.id, ...parsed.data, status: "pending",
    }).select().single();
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("KYC submitted — review pending");
    setExisting(data);
  };

  if (loading) return null;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Identity verification</h1>
        <p className="text-muted-foreground">Verify your identity to unlock higher transfer limits.</p>
      </div>

      {existing ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {existing.status === "verified" && <CheckCircle2 className="h-5 w-5 text-success" />}
              {existing.status === "rejected" && <XCircle className="h-5 w-5 text-destructive" />}
              {existing.status === "pending" && <Clock className="h-5 w-5 text-muted-foreground" />}
              KYC submission
            </CardTitle>
            <CardDescription>Submitted {new Date(existing.submitted_at).toLocaleString()}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Status</span>
              <Badge variant={existing.status === "verified" ? "default" : existing.status === "rejected" ? "destructive" : "secondary"} className="capitalize">{existing.status}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Document</span>
              <span className="text-sm font-medium capitalize">{existing.document_type.replace("_", " ")}</span>
            </div>
            {existing.status === "rejected" && (
              <p className="text-sm text-destructive">Your submission was rejected. Contact support to retry.</p>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Submit verification</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Document type</Label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="passport">Passport</SelectItem>
                    <SelectItem value="national_id">National ID</SelectItem>
                    <SelectItem value="drivers_license">Driver's License</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dn">Document number</Label>
                <Input id="dn" value={docNum} onChange={(e) => setDocNum(e.target.value)} required maxLength={50} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dob">Date of birth</Label>
                <Input id="dob" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="addr">Address</Label>
                <Textarea id="addr" value={addr} onChange={(e) => setAddr(e.target.value)} required maxLength={300} rows={3} />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                <ShieldCheck className="mr-2 h-4 w-4" />
                {submitting ? "Submitting..." : "Submit for review"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
