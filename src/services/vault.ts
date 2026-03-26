import { tauriInvoke } from './tauri';
import type { HostConfig, IdentityConfig } from '../types/host';

export interface UnlockAndLoadResponse {
  hosts: HostConfig[];
  identities: IdentityConfig[];
  version: number;
  updatedAt: number;
}

export interface SaveVaultResponse {
  version: number;
  updatedAt: number;
}

export interface ExportEncryptedBackupResponse {
  path: string;
  bytes: number;
}

export const unlockAndLoad = async (
  masterPassword: string
): Promise<UnlockAndLoadResponse> => {
  return tauriInvoke<UnlockAndLoadResponse>('unlock_and_load', {
    request: {
      masterPassword
    }
  });
};

export const saveVault = async (
  hosts: HostConfig[],
  identities: IdentityConfig[]
): Promise<SaveVaultResponse> => {
  return tauriInvoke<SaveVaultResponse>('save_vault', {
    request: {
      hosts,
      identities
    }
  });
};

export const exportEncryptedBackup = async (
  destinationPath: string
): Promise<ExportEncryptedBackupResponse> => {
  return tauriInvoke<ExportEncryptedBackupResponse>('export_encrypted_backup', {
    request: {
      destinationPath
    }
  });
};
