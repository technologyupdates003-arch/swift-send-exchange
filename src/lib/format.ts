export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", KES: "KSh", NGN: "₦",
};

export function formatMoney(amount: number | string, currency: string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const ALL_CURRENCIES = ["USD", "EUR", "GBP", "KES", "NGN"] as const;
