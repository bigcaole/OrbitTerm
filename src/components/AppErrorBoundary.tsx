import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logAppError } from '../services/appLog';

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  public constructor(props: AppErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      message: ''
    };
  }

  public static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const message = error instanceof Error ? error.message : '未知前端异常';
    return {
      hasError: true,
      message
    };
  }

  public componentDidCatch(error: unknown, info: ErrorInfo): void {
    const message = error instanceof Error ? `${error.message}\n${info.componentStack}` : info.componentStack;
    console.error('[OrbitTermErrorBoundary]', message);
    logAppError('renderer', '前端渲染异常', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      componentStack: info.componentStack
    });
  }

  public render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center px-4 py-10 sm:px-6">
        <section className="w-full rounded-3xl border border-rose-200 bg-rose-50/90 p-6 text-rose-900 shadow-xl sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-600">OrbitTerm</p>
          <h1 className="mt-2 text-xl font-semibold">界面渲染异常</h1>
          <p className="mt-2 text-sm leading-6">
            应用捕获到前端运行时错误，已阻止白屏扩散。你可以点击“重新加载”恢复，或把错误信息反馈给开发者。
          </p>
          <pre className="mt-4 overflow-auto rounded-xl border border-rose-200 bg-white/70 p-3 text-xs leading-5">
            {this.state.message || '未知错误'}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-rose-100"
              onClick={() => {
                window.location.reload();
              }}
              type="button"
            >
              重新加载
            </button>
          </div>
        </section>
      </main>
    );
  }
}
