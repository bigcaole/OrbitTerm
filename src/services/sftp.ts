import { tauriInvoke } from './tauri';

export interface SftpEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number | null;
  fileType: string;
}

interface SftpLsResponse {
  path: string;
  entries: SftpEntry[];
}

interface SftpTransferResponse {
  path: string;
  bytes: number;
}

export interface SftpTransferProgressEvent {
  sessionId: string;
  remotePath: string;
  localPath: string;
  progress: number;
}

export const sftpLs = async (
  sessionId: string,
  path: string
): Promise<SftpLsResponse> => {
  return tauriInvoke<SftpLsResponse>('sftp_ls', {
    request: {
      sessionId,
      path
    }
  });
};

export const sftpMkdir = async (sessionId: string, path: string): Promise<void> => {
  await tauriInvoke<void>('sftp_mkdir', {
    request: {
      sessionId,
      path
    }
  });
};

export const sftpRm = async (
  sessionId: string,
  path: string,
  recursive = false
): Promise<void> => {
  await tauriInvoke<void>('sftp_rm', {
    request: {
      sessionId,
      path,
      recursive
    }
  });
};

export const sftpRename = async (
  sessionId: string,
  fromPath: string,
  toPath: string
): Promise<void> => {
  await tauriInvoke<void>('sftp_rename', {
    request: {
      sessionId,
      fromPath,
      toPath
    }
  });
};

export const sftpUpload = async (
  sessionId: string,
  localPath: string,
  remotePath: string
): Promise<SftpTransferResponse> => {
  return tauriInvoke<SftpTransferResponse>('sftp_upload', {
    request: {
      sessionId,
      localPath,
      remotePath
    }
  });
};

export const sftpDownload = async (
  sessionId: string,
  remotePath: string,
  localPath: string
): Promise<SftpTransferResponse> => {
  return tauriInvoke<SftpTransferResponse>('sftp_download', {
    request: {
      sessionId,
      remotePath,
      localPath
    }
  });
};
