import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { Lock } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (pin: string) => Promise<void> | void;
  title?: string;
  description?: string;
  loading?: boolean;
}

export function PinDialog({ open, onClose, onSubmit, title = "Enter PIN", description = "Enter your 4-digit transaction PIN to confirm.", loading }: Props) {
  const [pin, setPin] = useState("");
  useEffect(() => { if (!open) setPin(""); }, [open]);

  const submit = async () => {
    if (pin.length !== 4) return;
    await onSubmit(pin);
    setPin("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-5 w-5" />
          </div>
          <DialogTitle className="text-center">{title}</DialogTitle>
          <DialogDescription className="text-center">{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          <InputOTP maxLength={4} value={pin} onChange={setPin} autoFocus inputMode="numeric" pattern="^\d*$">
            <InputOTPGroup>
              <InputOTPSlot index={0} />
              <InputOTPSlot index={1} />
              <InputOTPSlot index={2} />
              <InputOTPSlot index={3} />
            </InputOTPGroup>
          </InputOTP>
          <Button onClick={submit} disabled={pin.length !== 4 || loading} className="w-full">
            {loading ? "Verifying..." : "Confirm"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
