import { tauriInvoke } from './tauri';
import type { HostConfig, IdentityConfig, Snippet } from '../types/host';

export interface UnlockAndLoadResponse {
  hosts: HostConfig[];
  identities: IdentityConfig[];
  snippets: Snippet[];
  version: number;
  updatedAt: number;
}

export interface SaveVaultResponse {
  version: number;
  updatedAt: number;
}

export interface VaultSyncExportResponse {
  encryptedBlobBase64: string;
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
  identities: IdentityConfig[],
  snippets: Snippet[]
): Promise<SaveVaultResponse> => {
  return tauriInvoke<SaveVaultResponse>('save_vault', {
    request: {
      hosts,
      identities,
      snippets
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

export const exportVaultSyncBlob = async (): Promise<VaultSyncExportResponse> => {
  return tauriInvoke<VaultSyncExportResponse>('vault_export_sync_blob');
};

export const importVaultSyncBlob = async (
  encryptedBlobBase64: string
): Promise<UnlockAndLoadResponse> => {
  return tauriInvoke<UnlockAndLoadResponse>('vault_import_sync_blob', {
    request: {
      encryptedBlobBase64
    }
  });
};

export const clearVaultSession = async (): Promise<void> => {
  await tauriInvoke<void>('vault_clear_session');
};
