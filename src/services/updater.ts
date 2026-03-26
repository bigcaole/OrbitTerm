import { checkUpdate, installUpdate, type UpdateManifest } from '@tauri-apps/api/updater';

export interface UpdateCheckResult {
  shouldUpdate: boolean;
  manifest?: UpdateManifest;
}

export const checkForUpdate = async (): Promise<UpdateCheckResult> => {
  const result = await checkUpdate();
  return {
    shouldUpdate: result.shouldUpdate,
    manifest: result.manifest
  };
};

export const installAvailableUpdate = async (): Promise<void> => {
  await installUpdate();
};
