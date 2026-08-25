// Shield + radar/crosshair sweep mark — cyan on dark, per the prototypes'
// reference logo description. Used both as the header logo and as the
// source for app/icon.svg.
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="RecallRaid"
    >
      <path
        d="M32 4L56 12V28C56 44.8 46.2 55.6 32 60C17.8 55.6 8 44.8 8 28V12L32 4Z"
        stroke="#00DBE7"
        strokeWidth="3"
        fill="#0A0C0E"
      />
      <circle cx="32" cy="30" r="16" stroke="#00DBE7" strokeWidth="1.5" opacity="0.5" />
      <circle cx="32" cy="30" r="10" stroke="#00DBE7" strokeWidth="1.5" opacity="0.7" />
      <circle cx="32" cy="30" r="2.5" fill="#00DBE7" />
      <path d="M32 14V46" stroke="#00DBE7" strokeWidth="1" opacity="0.4" />
      <path d="M16 30H48" stroke="#00DBE7" strokeWidth="1" opacity="0.4" />
      <path d="M32 4L56 12V28C56 44.8 46.2 55.6 32 60" stroke="#00DBE7" strokeWidth="3" strokeLinecap="round">
        <animate attributeName="opacity" values="1;0.3;1" dur="3s" repeatCount="indefinite" />
      </path>
    </svg>
  );
}

export function LogoWithWordmark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <LogoMark size={26} />
      <span className="font-sans font-bold text-[15px] tracking-tight text-on-surface">
        RECALL<span className="text-primary">RAID</span>
      </span>
    </div>
  );
}
