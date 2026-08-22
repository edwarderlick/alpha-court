/** Deterministic identicon from an address. Same address → same mark. No network. */

function bytesFromAddress(address: string): number[] {
  const hex = address.toLowerCase().replace(/^0x/, "").padEnd(40, "0").slice(0, 40);
  const out: number[] = [];
  for (let i = 0; i < 20; i++) out.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0);
  return out;
}

function palette(b: number[]) {
  const hue = (b[0] * 13 + b[1] * 7 + b[2]) % 360;
  const hue2 = (hue + 140 + (b[3] % 40)) % 360;
  return {
    ink: `hsl(${hue} 78% 58%)`,
    wash: `hsl(${hue2} 32% 14%)`,
    spot: `hsl(${(hue + 40) % 360} 90% 62%)`,
  };
}

export function addressHue(address: string): number {
  const b = bytesFromAddress(address);
  return (b[0] * 13 + b[1] * 7 + b[2]) % 360;
}

export function AddressMark({
  address,
  size = 32,
  className = "",
}: {
  address?: string | null;
  size?: number;
  className?: string;
}) {
  if (!address || address.length < 8) {
    return (
      <span
        className={`inline-block rounded-full bg-surface-variant border border-white/10 ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  const b = bytesFromAddress(address);
  const { ink, wash, spot } = palette(b);
  const cells: { x: number; y: number; fill: string }[] = [];
  let k = 4;
  for (let y = 0; y < 8; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < 4; x++) {
      const on = ((b[k % 20] >> (x & 7)) & 1) === 1;
      k += 1;
      row.push(on);
    }
    const full = [...row, ...row.slice().reverse()];
    full.forEach((on, x) => {
      if (!on) return;
      cells.push({ x, y, fill: (x + y) % 3 === 0 ? spot : ink });
    });
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      className={`rounded-full shrink-0 ${className}`}
      shapeRendering="crispEdges"
      aria-hidden
    >
      <title>{address}</title>
      <rect width="8" height="8" fill={wash} />
      {cells.map((c, i) => (
        <rect key={i} x={c.x} y={c.y} width="1" height="1" fill={c.fill} />
      ))}
    </svg>
  );
}

export function shortenAddress(address: string): string {
  if (!address || address.length < 10) return address || "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
