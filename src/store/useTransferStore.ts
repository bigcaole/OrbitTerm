import { create } from 'zustand';
import {
  sftpDownload,
  type SftpTransferProgressEvent,
  sftpUpload
} from '../services/sftp';

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'waiting' | 'running' | 'completed' | 'failed';

export interface TransferTask {
  id: string;
  sessionId: string;
  direction: TransferDirection;
  fileName: string;
  localPath: string;
  remotePath: string;
  totalBytes: number;
  transferredBytes: number;
  status: TransferStatus;
  error: string | null;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
}

interface TransferStoreState {
  transferQueue: TransferTask[];
  maxConcurrent: number;
  panelCollapsed: boolean;
  enqueueUploadTask: (payload: {
    sessionId: string;
    localPath: string;
    remotePath: string;
    fileName: string;
    totalBytes?: number;
  }) => string;
  enqueueDownloadTask: (payload: {
    sessionId: string;
    localPath: string;
    remotePath: string;
    fileName: string;
    totalBytes?: number;
  }) => string;
  retryTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  clearFinished: () => void;
  setMaxConcurrent: (value: number) => void;
  setPanelCollapsed: (value: boolean) => void;
  applyProgressEvent: (event: SftpTransferProgressEvent) => void;
}

const MAX_ALLOWED_CONCURRENT = 6;
const MIN_ALLOWED_CONCURRENT = 1;

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

const createTaskId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `transfer-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const activeTaskIds = new Set<string>();

const runScheduler = (): void => {
  void runSchedulerAsync();
};

const runSchedulerAsync = async (): Promise<void> => {
  const state = useTransferStore.getState();
  const runningCount = state.transferQueue.filter((task) => task.status === 'running').length;
  const availableSlots = Math.max(0, state.maxConcurrent - runningCount);
  if (availableSlots <= 0) {
    return;
  }

  const waitingTasks = state.transferQueue
    .filter((task) => task.status === 'waiting')
    .sort((a, b) => a.createdAt - b.createdAt)
    .slice(0, availableSlots);

  for (const task of waitingTasks) {
    if (activeTaskIds.has(task.id)) {
      continue;
    }
    activeTaskIds.add(task.id);
    useTransferStore.setState((prev) => ({
      transferQueue: prev.transferQueue.map((item) => {
        if (item.id !== task.id) {
          return item;
        }
        return {
          ...item,
          status: 'running',
          error: null,
          updatedAt: Date.now()
        };
      })
    }));

    void executeTask(task.id);
  }
};

const executeTask = async (taskId: string): Promise<void> => {
  const current = useTransferStore.getState().transferQueue.find((item) => item.id === taskId);
  if (!current) {
    activeTaskIds.delete(taskId);
    return;
  }

  const resumeFrom = current.transferredBytes > 0 ? current.transferredBytes : 0;
  try {
    const response =
      current.direction === 'upload'
        ? await sftpUpload(current.sessionId, current.localPath, current.remotePath, {
            transferId: current.id,
            resumeFrom
          })
        : await sftpDownload(current.sessionId, current.remotePath, current.localPath, {
            transferId: current.id,
            resumeFrom
          });

    useTransferStore.setState((prev) => ({
      transferQueue: prev.transferQueue.map((item) => {
        if (item.id !== taskId) {
          return item;
        }
        const resolvedTotal = response.totalBytes > 0 ? response.totalBytes : item.totalBytes;
        const resolvedTransferred =
          resolvedTotal > 0 ? resolvedTotal : Math.max(item.transferredBytes, response.bytes);
        return {
          ...item,
          status: 'completed',
          totalBytes: resolvedTotal,
          transferredBytes: resolvedTransferred,
          error: null,
          updatedAt: Date.now()
        };
      })
    }));
  } catch (error) {
    const fallback = '传输中断，请点击重试继续。';
    const message = error instanceof Error ? error.message : fallback;
    useTransferStore.setState((prev) => ({
      transferQueue: prev.transferQueue.map((item) => {
        if (item.id !== taskId) {
          return item;
        }
        return {
          ...item,
          status: 'failed',
          error: message || fallback,
          updatedAt: Date.now()
        };
      })
    }));
  } finally {
    activeTaskIds.delete(taskId);
    runScheduler();
  }
};

export const useTransferStore = create<TransferStoreState>((set) => ({
  transferQueue: [],
  maxConcurrent: 2,
  panelCollapsed: false,
  enqueueUploadTask: (payload) => {
    const id = createTaskId();
    const now = Date.now();
    set((state) => ({
      transferQueue: [
        ...state.transferQueue,
        {
          id,
          sessionId: payload.sessionId,
          direction: 'upload',
          fileName: payload.fileName,
          localPath: payload.localPath,
          remotePath: payload.remotePath,
          totalBytes: payload.totalBytes ?? 0,
          transferredBytes: 0,
          status: 'waiting',
          error: null,
          retryCount: 0,
          createdAt: now,
          updatedAt: now
        }
      ]
    }));
    runScheduler();
    return id;
  },
  enqueueDownloadTask: (payload) => {
    const id = createTaskId();
    const now = Date.now();
    set((state) => ({
      transferQueue: [
        ...state.transferQueue,
        {
          id,
          sessionId: payload.sessionId,
          direction: 'download',
          fileName: payload.fileName,
          localPath: payload.localPath,
          remotePath: payload.remotePath,
          totalBytes: payload.totalBytes ?? 0,
          transferredBytes: 0,
          status: 'waiting',
          error: null,
          retryCount: 0,
          createdAt: now,
          updatedAt: now
        }
      ]
    }));
    runScheduler();
    return id;
  },
  retryTask: (taskId) => {
    set((state) => ({
      transferQueue: state.transferQueue.map((item) => {
        if (item.id !== taskId) {
          return item;
        }
        if (item.status === 'running') {
          return item;
        }
        return {
          ...item,
          status: 'waiting',
          error: null,
          retryCount: item.retryCount + 1,
          updatedAt: Date.now()
        };
      })
    }));
    runScheduler();
  },
  removeTask: (taskId) => {
    activeTaskIds.delete(taskId);
    set((state) => ({
      transferQueue: state.transferQueue.filter((item) => item.id !== taskId)
    }));
  },
  clearFinished: () => {
    set((state) => ({
      transferQueue: state.transferQueue.filter(
        (item) => item.status === 'running' || item.status === 'waiting'
      )
    }));
  },
  setMaxConcurrent: (value) => {
    set({
      maxConcurrent: clamp(
        Math.round(value),
        MIN_ALLOWED_CONCURRENT,
        MAX_ALLOWED_CONCURRENT
      )
    });
    runScheduler();
  },
  setPanelCollapsed: (value) => {
    set({ panelCollapsed: value });
  },
  applyProgressEvent: (event) => {
    set((state) => ({
      transferQueue: state.transferQueue.map((item) => {
        if (item.id !== event.transferId) {
          return item;
        }
        const nextTotal = event.totalBytes > 0 ? event.totalBytes : item.totalBytes;
        const nextTransferred = Math.max(item.transferredBytes, event.transferredBytes);
        const nextStatus = item.status === 'waiting' ? 'running' : item.status;
        return {
          ...item,
          status: nextStatus,
          totalBytes: nextTotal,
          transferredBytes: nextTransferred,
          updatedAt: Date.now()
        };
      })
    }));
  }
}));
