interface StepIndicatorProps {
  currentStep: 1 | 2 | 3;
}

const titles = ['基础信息', '认证配置', '高级选项'] as const;

export function StepIndicator({ currentStep }: StepIndicatorProps): JSX.Element {
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {titles.map((title, index) => {
        const step = (index + 1) as 1 | 2 | 3;
        const isActive = step === currentStep;
        const isDone = step < currentStep;

        return (
          <li
            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 transition ${
              isActive
                ? 'border-frost-accent/40 bg-white/65 shadow-panel'
                : 'border-white/40 bg-white/35'
            }`}
            key={title}
          >
            <span
              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                isDone
                  ? 'bg-frost-accent text-white'
                  : isActive
                    ? 'bg-frost-accentSoft text-white'
                    : 'bg-white text-slate-500'
              }`}
            >
              {step}
            </span>
            <span className={`text-sm font-medium ${isActive ? 'text-slate-900' : 'text-slate-600'}`}>
              {title}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
