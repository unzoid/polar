/**
 * Apple-style smoothed rounded rectangle as SVG path data.
 * `smoothing` is 0–100, where 60 matches Figma's iOS preset.
 */
export function squirclePath(width: number, height: number, radius: number, smoothing = 60): string {
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  if (!w || !h) return "";
  const r = Math.min(Math.max(radius, 0), Math.min(w, h) / 2);
  if (!r) return `M0 0H${w}V${h}H0Z`;

  const exponent = 2 + (Math.min(Math.max(smoothing, 0), 100) / 100) * 3.35;
  const steps = 22;
  const pts: string[] = [`${r} 0`, `${w - r} 0`];

  const corner = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 1; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const x = cx + r * Math.sign(cos) * Math.abs(cos) ** (2 / exponent);
      const y = cy + r * Math.sign(sin) * Math.abs(sin) ** (2 / exponent);
      pts.push(`${x.toFixed(2)} ${y.toFixed(2)}`);
    }
  };

  corner(w - r, r, -Math.PI / 2, 0);
  pts.push(`${w} ${h - r}`);
  corner(w - r, h - r, 0, Math.PI / 2);
  pts.push(`${r} ${h}`);
  corner(r, h - r, Math.PI / 2, Math.PI);
  pts.push(`0 ${r}`);
  corner(r, r, Math.PI, Math.PI * 1.5);

  return `M${pts.join("L")}Z`;
}
