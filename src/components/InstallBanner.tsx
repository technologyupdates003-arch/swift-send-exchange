import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Share, Smartphone, X } from "lucide-react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.startsWith("android-app://")
  );
}

function isIos() {
  const ua = window.navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && !(window as any).MSStream;
}

function isAndroid() {
  return /android/i.test(window.navigator.userAgent);
}

function isMobile() {
  return isIos() || isAndroid();
}

export function InstallBanner() {
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (installed) return;
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt as any);
    window.addEventListener("appinstalled", onInstalled);
    const mq = window.matchMedia("(display-mode: standalone)");
    const onChange = () => setInstalled(isStandalone());
    mq.addEventListener?.("change", onChange);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt as any);
      window.removeEventListener("appinstalled", onInstalled);
      mq.removeEventListener?.("change", onChange);
    };
  }, [installed]);

  if (installed) return null;
  if (!isMobile()) return null;

  const onInstall = async () => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      if (outcome === "accepted") setInstalled(true);
      setDeferred(null);
    } else {
      setShowHelp((v) => !v);
    }
  };

  return (
    <div className="sticky top-0 z-50 border-b bg-primary text-primary-foreground shadow-sm">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
        <Smartphone className="h-4 w-4 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-medium leading-tight">Install AbanRemit</p>
          <p className="text-xs opacity-90 leading-tight">
            {isIos()
              ? "Tap Share, then 'Add to Home Screen'."
              : deferred
              ? "Get the app for faster, full-screen access."
              : "Tap your browser menu, then 'Install app'."}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onInstall}
          className="shrink-0 h-8"
        >
          {isIos() ? <Share className="mr-1 h-3.5 w-3.5" /> : <Download className="mr-1 h-3.5 w-3.5" />}
          Install
        </Button>
      </div>
      {showHelp && (
        <div className="border-t border-primary-foreground/20 bg-primary/95 px-4 py-2 text-xs">
          {isIos() ? (
            <>1. Tap the <Share className="inline h-3 w-3" /> Share button in Safari · 2. Scroll and tap <strong>Add to Home Screen</strong> · 3. Tap <strong>Add</strong>.</>
          ) : (
            <>1. Open your browser menu (⋮) · 2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong> · 3. Confirm <strong>Install</strong>.</>
          )}
        </div>
      )}
    </div>
  );
}
