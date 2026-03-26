interface TooltipProps {
  content: string;
}

export function Tooltip({ content }: TooltipProps): JSX.Element {
  return (
    <span className="group relative inline-flex items-center">
      <span
        aria-label="字段说明"
        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-white/60 bg-white/40 text-xs font-semibold text-slate-600"
        tabIndex={0}
      >
        ?
      </span>
      <span className="pointer-events-none absolute left-1/2 top-[130%] z-20 hidden w-64 -translate-x-1/2 rounded-xl border border-white/65 bg-white/90 p-3 text-xs leading-5 text-slate-700 shadow-panel group-hover:block group-focus-within:block">
        {content}
      </span>
    </span>
  );
}
