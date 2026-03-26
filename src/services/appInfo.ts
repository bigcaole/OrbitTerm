import { tauriInvoke } from './tauri';

export const getAppVersion = async (): Promise<string> => {
  return tauriInvoke<string>('app_version');
};
