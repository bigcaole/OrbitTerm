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
  totalBytes: number;
}

interface SftpReadTextResponse {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
}

export interface SftpTransferProgressEvent {
  sessionId: string;
  transferId: string;
  direction: 'upload' | 'download';
  remotePath: string;
  localPath: string;
  transferredBytes: number;
  totalBytes: number;
  progress: number;
}

interface SftpTransferOptions {
  transferId?: string;
  resumeFrom?: number;
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
  remotePath: string,
  options?: SftpTransferOptions
): Promise<SftpTransferResponse> => {
  return tauriInvoke<SftpTransferResponse>('sftp_upload', {
    request: {
      sessionId,
      localPath,
      remotePath,
      transferId: options?.transferId,
      resumeFrom: options?.resumeFrom
    }
  });
};

const encodeUtf8Base64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
};

export const sftpUploadContent = async (
  sessionId: string,
  remotePath: string,
  content: string
): Promise<SftpTransferResponse> => {
  return tauriInvoke<SftpTransferResponse>('sftp_upload', {
    request: {
      sessionId,
      remotePath,
      contentBase64: encodeUtf8Base64(content),
      resumeFrom: 0
    }
  });
};

export const sftpDownload = async (
  sessionId: string,
  remotePath: string,
  localPath: string,
  options?: SftpTransferOptions
): Promise<SftpTransferResponse> => {
  return tauriInvoke<SftpTransferResponse>('sftp_download', {
    request: {
      sessionId,
      remotePath,
      localPath,
      transferId: options?.transferId,
      resumeFrom: options?.resumeFrom
    }
  });
};

export const sftpReadText = async (
  sessionId: string,
  remotePath: string,
  maxBytes = 2 * 1024 * 1024
): Promise<SftpReadTextResponse> => {
  return tauriInvoke<SftpReadTextResponse>('sftp_read_text', {
    request: {
      sessionId,
      remotePath,
      maxBytes
    }
  });
};
