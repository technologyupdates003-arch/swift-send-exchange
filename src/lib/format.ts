export const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$", EUR: "€", GBP: "£", KES: "KSh", NGN: "₦", ABN: "ABN ",
};

export function formatMoney(amount: number | string, currency: string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  const decimals = currency === "ABN" ? 4 : 2;
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

export const ALL_CURRENCIES = ["USD", "EUR", "GBP", "KES", "NGN", "ABN"] as const;
export const FIAT_CURRENCIES = ["USD", "EUR", "GBP", "KES", "NGN"] as const;
