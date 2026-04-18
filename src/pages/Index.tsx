import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/Logo";
import { ArrowRight, Globe, Shield, Zap } from "lucide-react";

export default function Index() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Logo size="md" />
          <div className="flex gap-2">
            <Button asChild variant="ghost"><Link to="/login">Sign in</Link></Button>
            <Button asChild><Link to="/signup">Get started</Link></Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-[image:var(--gradient-hero)] text-hero-foreground">
        <div className="mx-auto max-w-6xl px-4 py-20 md:py-28">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs">
            <span className="h-2 w-2 rounded-full bg-success" /> 99.9% uptime guarantee
          </div>
          <h1 className="mt-6 text-4xl font-bold leading-tight md:text-6xl">
            Send money across the world with{" "}
            <span className="text-primary">Swift Remit</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-hero-foreground/80">
            Multi-currency wallets, real-time exchange rates, and instant transfers — built for speed,
            reliability, and the realities of moving money globally.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/signup">Open free account <ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to="/login">I already have an account</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Zap, title: "Instant transfers", text: "Wallet-to-wallet payments settle in seconds, 24/7." },
            { icon: Globe, title: "Multi-currency", text: "Hold and move USD, EUR, GBP, KES and NGN." },
            { icon: Shield, title: "Bank-grade security", text: "Encrypted at rest, RLS-enforced access." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border bg-card p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
