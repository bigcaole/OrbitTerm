import { invoke as tauriApiInvoke } from '@tauri-apps/api/tauri';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type CompatTauriWindow = Window & {
  __TAURI__?: {
    invoke?: TauriInvoke;
    core?: {
      invoke?: TauriInvoke;
    };
  };
};

const hasTauriIpc = (): boolean => {
  return typeof window !== 'undefined' && typeof window.__TAURI_IPC__ === 'function';
};

const getInvoke = (): TauriInvoke | null => {
  const compatWindow = window as CompatTauriWindow;

  if (hasTauriIpc()) {
    return tauriApiInvoke as TauriInvoke;
  }

  const legacyInvoke = compatWindow.__TAURI__?.invoke;
  if (legacyInvoke) {
    return legacyInvoke;
  }

  const coreInvoke = compatWindow.__TAURI__?.core?.invoke;
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

  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('__TAURI_IPC__')) {
      throw new Error('未检测到 Tauri 运行环境，请在桌面端应用中执行解锁。');
    }
    throw error;
  }
};
