type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

declare global {
  interface Window {
    __TAURI__?: {
      invoke?: TauriInvoke;
      core?: {
        invoke?: TauriInvoke;
      };
    };
  }
}

const getInvoke = (): TauriInvoke | null => {
  const legacyInvoke = window.__TAURI__?.invoke;
  if (legacyInvoke) {
    return legacyInvoke;
  }

  const coreInvoke = window.__TAURI__?.core?.invoke;
  if (coreInvoke) {
    return coreInvoke;
  }

  return null;
};

export const tauriInvoke = async <T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> => {
  const invoke = getInvoke();
  if (!invoke) {
    throw new Error('未检测到 Tauri 运行环境，请在桌面端应用中执行解锁。');
  }

  return invoke<T>(command, args);
};
