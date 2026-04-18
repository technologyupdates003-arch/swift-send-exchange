import { Cloud } from "lucide-react";

export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-12 w-12" : "h-10 w-10";
  const text = size === "sm" ? "text-base" : size === "lg" ? "text-2xl" : "text-lg";
  return (
    <div className="flex items-center gap-2">
      <div className={`${dim} flex items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[var(--shadow-brand)]`}>
        <Cloud className="h-1/2 w-1/2" />
      </div>
      <span className={`${text} font-bold tracking-tight`}>
        AbanRemit<span className="text-primary">.</span>
      </span>
    </div>
  );
}
