/** Exported Figma artwork only; the wordmark is never retyped. */
export function Logo({ variant = "paper", kind = "horizontal", className, height = 28 }: {
  variant?: "paper" | "ink" | "primary"; kind?: "horizontal" | "symbol" | "stacked" | "wordmark"; className?: string; height?: number;
}) {
  const ratio = { horizontal: 372 / 47, symbol: 240 / 153, stacked: 1, wordmark: 4.8 }[kind];
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/brand/${kind}-${variant}.svg`} alt="OCCASIO" height={height} width={Math.round(height * ratio)} className={className} style={{ height, width: "auto" }} />;
}

export function Symbol({ variant = "ink", className, size = 200, decorative = true }: { variant?: "paper" | "ink" | "primary"; className?: string; size?: number; decorative?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/brand/symbol-${variant}.svg`} alt={decorative ? "" : "OCCASIO symbol"} aria-hidden={decorative || undefined} width={size} height={Math.round((size * 153) / 240)} className={className} />;
}
