/** Line-only Alpha Court mark: court square + A + lime bench bar. */
export function AlphaMark({
  className,
  variant = "brand",
  title = "Alpha Court",
}: {
  className?: string;
  variant?: "brand" | "mono";
  title?: string;
}) {
  const court = variant === "brand" ? "#BD00FF" : "currentColor";
  const letter = variant === "brand" ? "#ECB2FF" : "currentColor";
  const bench = variant === "brand" ? "#C7F300" : "currentColor";
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <rect
        x="3.25"
        y="3.25"
        width="25.5"
        height="25.5"
        rx="2.5"
        stroke={court}
        strokeWidth="1.75"
      />
      <path
        d="M9.5 23.25 L16 8.75 L22.5 23.25"
        stroke={letter}
        strokeWidth="1.75"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
      <path d="M12 17.25 H20" stroke={bench} strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  );
}
