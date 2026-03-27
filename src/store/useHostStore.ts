import { create } from 'zustand';
import { toast } from 'sonner';
import {
  finalHostSchema,
  identitySchema,
  snippetSchema,
  type Step1FormValues,
  type Step2FormValues,
  type Step3FormValues
} from '../schemas/hostSchemas';
import type { HostConfig, IdentityConfig, Snippet } from '../types/host';
import {
  clearVaultSession,
  exportVaultSyncBlob,
  importVaultSyncBlob,
  saveVault,
  unlockAndLoad
} from '../services/vault';
import {
  CloudSyncConflictError,
  clearCloudSyncSession,
  getCloudSyncStatus,
  listCloudDevices,
  loginCloudSync,
  logoutAllCloudDevices,
  logoutCloudDevice,
  pullCloudSyncBlob,
  pushCloudSyncBlob,
  readCloudSyncSession,
  registerCloudSync,
  type CloudDeviceItem,
  type CloudSyncSession
} from '../services/cloudSync';
import { type ProxyJumpHop, sshConnect, sshDisconnect } from '../services/ssh';
import { buildHostKey } from '../utils/hostKey';

type WizardStep = 1 | 2 | 3;
type AppView = 'locked' | 'dashboard';

export interface TerminalSession {
  id: string;
  title: string;
  hostId: string;
}

export interface HostEditPayload {
  basicInfo: {
    name: string;
    address: string;
    port: number;
    description: string;
    tagsText: string;
  };
  identity: {
    name: string;
    username: string;
    authConfig: Step2FormValues;
  };
}

interface HostState {
  appView: AppView;
  hosts: HostConfig[];
  identities: IdentityConfig[];
  snippets: Snippet[];
  vaultVersion: number | null;
  vaultUpdatedAt: number | null;
  isUnlocking: boolean;
  unlockError: string | null;
  isSavingVault: boolean;
  saveError: string | null;
  cloudSyncSession: CloudSyncSession | null;
  cloudSyncVersion: number | null;
  cloudSyncLastAt: string | null;
  cloudDevices: CloudDeviceItem[];
  isLoadingCloudDevices: boolean;
  isSyncingCloud: boolean;
  cloudSyncError: string | null;
  activeSessions: TerminalSession[];
  activeSessionId: string | null;
  isConnectingTerminal: boolean;
  terminalError: string | null;
  currentStep: WizardStep;
  basicInfo: Step1FormValues;
  authConfig: Step2FormValues;
  advancedOptions: Step3FormValues;
  submittedHost: HostConfig | null;
  unlockVault: (masterPassword: string) => Promise<void>;
  lockVault: () => Promise<void>;
  registerCloudAccount: (apiBaseUrl: string, email: string, password: string) => Promise<void>;
  loginCloudAccount: (apiBaseUrl: string, email: string, password: string) => Promise<void>;
  logoutCloudAccount: () => void;
  loadCloudDevices: () => Promise<void>;
  revokeCloudDevice: (deviceId: string) => Promise<void>;
  revokeAllCloudDevices: () => Promise<void>;
  syncPushToCloud: () => Promise<void>;
  syncPullFromCloud: () => Promise<void>;
  setHosts: (hosts: HostConfig[]) => void;
  setIdentities: (identities: IdentityConfig[]) => void;
  addIdentity: (payload: {
    name: string;
    username: string;
    authConfig: Step2FormValues;
  }) => Promise<IdentityConfig>;
  addSnippet: (payload: { title: string; command: string; tags: string[] }) => Promise<void>;
  updateSnippet: (
    snippetId: string,
    payload: { title: string; command: string; tags: string[] }
  ) => Promise<void>;
  deleteSnippet: (snippetId: string) => Promise<void>;
  updateHostAndIdentity: (hostId: string, payload: HostEditPayload) => Promise<void>;
  deleteHost: (hostId: string) => Promise<void>;
  updateIdentity: (identity: IdentityConfig) => Promise<void>;
  switchView: (view: AppView) => void;
  openDetachedSession: (hostId: string) => Promise<TerminalSession>;
  openTerminal: (host: HostConfig) => Promise<boolean>;
  openNewTab: () => Promise<void>;
  setActiveSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
  handleSessionClosed: (sessionId: string) => 'manual' | 'abnormal';
  closeTerminal: () => Promise<void>;
  setTerminalError: (message: string | null) => void;
  setStep: (step: WizardStep) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateBasicInfo: (payload: Step1FormValues) => void;
  updateAuthConfig: (payload: Step2FormValues) => void;
  updateAdvancedOptions: (payload: Step3FormValues) => void;
  applyDemoHostTemplate: () => void;
  submitHost: () => Promise<HostConfig>;
  reset: () => void;
}

const initialBasicInfo: Step1FormValues = {
  name: '',
  address: '',
  port: 22,
  description: '',
  identityMode: 'new',
  identityId: '',
  identityName: '',
  identityUsername: 'root'
};

const initialAuthConfig: Step2FormValues = {
  method: 'password',
  password: '',
  privateKey: '',
  passphrase: ''
};

const initialAdvancedOptions: Step3FormValues = {
  jumpHost: '',
  proxyJumpHostId: '',
  connectionTimeout: 10,
  keepAliveEnabled: true,
  keepAliveInterval: 30,
  compression: true,
  strictHostKeyChecking: true,
  tagsText: ''
};

const parseTags = (tagsText: string): string[] => {
  if (!tagsText.trim()) {
    return [];
  }

  return Array.from(
    new Set(
      tagsText
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown, fallback = ''): string => {
  return typeof value === 'string' ? value : fallback;
};

const asBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const asInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = Math.round(parsed);
  if (normalized < min || normalized > max) {
    return fallback;
  }
  return normalized;
};

const createFallbackId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const normalizeAuthConfig = (value: unknown): Step2FormValues => {
  const auth = asRecord(value);
  const method = auth?.method === 'privateKey' ? 'privateKey' : 'password';
  return {
    method,
    password: asString(auth?.password),
    privateKey: asString(auth?.privateKey),
    passphrase: asString(auth?.passphrase)
  };
};

const normalizeIdentities = (
  raw: unknown
): { identities: IdentityConfig[]; discarded: number } => {
  if (!Array.isArray(raw)) {
    return { identities: [], discarded: 0 };
  }

  const identities: IdentityConfig[] = [];
  let discarded = 0;

  for (const item of raw) {
    const identity = asRecord(item);
    if (!identity) {
      discarded += 1;
      continue;
    }
    const id = asString(identity.id).trim();
    const username = asString(identity.username).trim();
    if (!id || !username) {
      discarded += 1;
      continue;
    }
    const name = asString(identity.name).trim() || `${username}@identity`;
    identities.push({
      id,
      name,
      username,
      authConfig: normalizeAuthConfig(identity.authConfig)
    });
  }

  return { identities, discarded };
};

const normalizeHosts = (
  raw: unknown
): { hosts: HostConfig[]; discarded: number } => {
  if (!Array.isArray(raw)) {
    return { hosts: [], discarded: 0 };
  }

  const hosts: HostConfig[] = [];
  let discarded = 0;

  for (const item of raw) {
    const host = asRecord(item);
    const basicInfo = asRecord(host?.basicInfo);
    const advancedOptions = asRecord(host?.advancedOptions);
    if (!host || !basicInfo || !advancedOptions) {
      discarded += 1;
      continue;
    }

    const address = asString(basicInfo.address).trim();
    const identityId = asString(host.identityId).trim();
    if (!address || !identityId) {
      discarded += 1;
      continue;
    }

    const port = asInteger(basicInfo.port, 22, 1, 65535);
    const normalizedName = asString(basicInfo.name).trim() || `${address}:${port}`;
    const rawTags = Array.isArray(advancedOptions.tags) ? advancedOptions.tags : [];
    const tags = Array.from(
      new Set(
        rawTags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    ).slice(0, 20);

    hosts.push({
      basicInfo: {
        name: normalizedName,
        address,
        port,
        description: asString(basicInfo.description)
      },
      identityId,
      advancedOptions: {
        jumpHost: asString(advancedOptions.jumpHost),
        proxyJumpHostId: asString(advancedOptions.proxyJumpHostId),
        connectionTimeout: asInteger(advancedOptions.connectionTimeout, 10, 1, 120),
        keepAliveEnabled: asBoolean(advancedOptions.keepAliveEnabled, true),
        keepAliveInterval: asInteger(advancedOptions.keepAliveInterval, 30, 5, 600),
        compression: asBoolean(advancedOptions.compression, true),
        strictHostKeyChecking: asBoolean(advancedOptions.strictHostKeyChecking, true),
        tags
      }
    });
  }

  return { hosts, discarded };
};

const normalizeSnippets = (
  raw: unknown
): { snippets: Snippet[]; discarded: number } => {
  if (!Array.isArray(raw)) {
    return { snippets: [], discarded: 0 };
  }

  const snippets: Snippet[] = [];
  let discarded = 0;

  for (const item of raw) {
    const snippet = asRecord(item);
    if (!snippet) {
      discarded += 1;
      continue;
    }

    const command = asString(snippet.command).trim();
    if (!command) {
      discarded += 1;
      continue;
    }

    const title = asString(snippet.title).trim() || `片段-${snippets.length + 1}`;
    const id = asString(snippet.id).trim() || createFallbackId('snippet');
    const rawTags = Array.isArray(snippet.tags) ? snippet.tags : [];
    const tags = Array.from(
      new Set(
        rawTags
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean)
      )
    ).slice(0, 20);

    snippets.push({
      id,
      title,
      command,
      tags
    });
  }

  return { snippets, discarded };
};

const normalizeVaultSnapshot = (payload: {
  hosts: unknown;
  identities: unknown;
  snippets: unknown;
}): {
  hosts: HostConfig[];
  identities: IdentityConfig[];
  snippets: Snippet[];
  discarded: number;
} => {
  const normalizedIdentities = normalizeIdentities(payload.identities);
  const normalizedHosts = normalizeHosts(payload.hosts);
  const normalizedSnippets = normalizeSnippets(payload.snippets);

  const identities = [...normalizedIdentities.identities];
  const identitySet = new Set(identities.map((identity) => identity.id));
  for (const host of normalizedHosts.hosts) {
    if (identitySet.has(host.identityId)) {
      continue;
    }
    identitySet.add(host.identityId);
    identities.push({
      id: host.identityId,
      name: `恢复身份-${host.identityId.slice(0, 6) || 'default'}`,
      username: 'root',
      authConfig: {
        method: 'password',
        password: '',
        privateKey: '',
        passphrase: ''
      }
    });
  }

  return {
    hosts: normalizedHosts.hosts,
    identities,
    snippets: normalizedSnippets.snippets,
    discarded:
      normalizedIdentities.discarded +
      normalizedHosts.discarded +
      normalizedSnippets.discarded
  };
};

const buildHostId = (host: HostConfig): string => {
  return buildHostKey(host);
};

const manualClosingSessions = new Set<string>();
const manualClosingTimers = new Map<string, number>();

const markManualClosing = (sessionId: string): void => {
  manualClosingSessions.add(sessionId);
  const timer = manualClosingTimers.get(sessionId);
  if (timer) {
    window.clearTimeout(timer);
  }
  const timeoutId = window.setTimeout(() => {
    manualClosingSessions.delete(sessionId);
    manualClosingTimers.delete(sessionId);
  }, 30000);
  manualClosingTimers.set(sessionId, timeoutId);
};

const consumeManualClosing = (sessionId: string): boolean => {
  const had = manualClosingSessions.has(sessionId);
  manualClosingSessions.delete(sessionId);
  const timer = manualClosingTimers.get(sessionId);
  if (timer) {
    window.clearTimeout(timer);
    manualClosingTimers.delete(sessionId);
  }
  return had;
};

const parseJumpHostAddress = (raw: string): { address: string; port: number } | null => {
  const text = raw.trim();
  if (!text) {
    return null;
  }

  if (text.startsWith('[')) {
    const closeIdx = text.indexOf(']');
    if (closeIdx <= 0) {
      return null;
    }
    const address = text.slice(0, closeIdx + 1);
    const rest = text.slice(closeIdx + 1).trim();
    if (!rest) {
      return { address, port: 22 };
    }
    if (!rest.startsWith(':')) {
      return null;
    }
    const parsedPort = Number(rest.slice(1));
    if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      return null;
    }
    return { address, port: parsedPort };
  }

  const lastColon = text.lastIndexOf(':');
  if (lastColon > 0 && text.indexOf(':') === lastColon) {
    const host = text.slice(0, lastColon).trim();
    const parsedPort = Number(text.slice(lastColon + 1));
    if (!host || !Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
      return null;
    }
    return { address: host, port: parsedPort };
  }

  return { address: text, port: 22 };
};

const buildProxyChain = (
  host: HostConfig,
  targetIdentity: IdentityConfig,
  hosts: HostConfig[],
  identities: IdentityConfig[]
): ProxyJumpHop[] => {
  const chain: ProxyJumpHop[] = [];
  const visited = new Set<string>();

  let currentJumpId = host.advancedOptions.proxyJumpHostId.trim();
  while (currentJumpId) {
    if (visited.has(currentJumpId)) {
      throw new Error('检测到跳板链路循环，请检查 ProxyJump 配置。');
    }
    visited.add(currentJumpId);

    const jumpHost = hosts.find((item) => buildHostId(item) === currentJumpId);
    if (!jumpHost) {
      throw new Error('找不到指定的跳板机，请确认该主机仍存在。');
    }
    const jumpIdentity = identities.find((item) => item.id === jumpHost.identityId);
    if (!jumpIdentity) {
      throw new Error(`跳板机 ${jumpHost.basicInfo.name} 未绑定有效身份。`);
    }

    chain.push({
      hostConfig: jumpHost,
      identityConfig: jumpIdentity
    });

    currentJumpId = jumpHost.advancedOptions.proxyJumpHostId.trim();
  }

  chain.reverse();

  const manualJump = host.advancedOptions.jumpHost.trim();
  if (!chain.length && manualJump) {
    const parsed = parseJumpHostAddress(manualJump);
    if (!parsed) {
      throw new Error('手动跳板地址格式错误，请使用 host:port（端口可省略）。');
    }

    chain.push({
      hostConfig: {
        basicInfo: {
          name: `manual-jump-${parsed.address}:${parsed.port}`,
          address: parsed.address,
          port: parsed.port,
          description: 'manual proxy jump'
        },
        identityId: targetIdentity.id,
        advancedOptions: {
          jumpHost: '',
          proxyJumpHostId: '',
          connectionTimeout: host.advancedOptions.connectionTimeout,
          keepAliveEnabled: host.advancedOptions.keepAliveEnabled,
          keepAliveInterval: host.advancedOptions.keepAliveInterval,
          compression: host.advancedOptions.compression,
          strictHostKeyChecking: host.advancedOptions.strictHostKeyChecking,
          tags: []
        }
      },
      identityConfig: targetIdentity
    });
  }

  return chain;
};

const removeSessionAndPickActive = (
  sessions: TerminalSession[],
  removedId: string,
  currentActiveId: string | null
): { sessions: TerminalSession[]; activeSessionId: string | null } => {
  const removedIndex = sessions.findIndex((session) => session.id === removedId);
  if (removedIndex < 0) {
    return { sessions, activeSessionId: currentActiveId };
  }

  const nextSessions = sessions.filter((session) => session.id !== removedId);
  if (currentActiveId !== removedId) {
    return { sessions: nextSessions, activeSessionId: currentActiveId };
  }

  if (nextSessions.length === 0) {
    return { sessions: nextSessions, activeSessionId: null };
  }

  const fallbackIndex = removedIndex > 0 ? removedIndex - 1 : 0;
  const nextActiveSession = nextSessions[Math.min(fallbackIndex, nextSessions.length - 1)];
  if (!nextActiveSession) {
    return { sessions: nextSessions, activeSessionId: null };
  }
  return { sessions: nextSessions, activeSessionId: nextActiveSession.id };
};

const createIdentityId = (): string => {
  return createFallbackId('identity');
};

const createSnippetId = (): string => {
  return createFallbackId('snippet');
};

const initialCloudSyncSession = readCloudSyncSession();
const CLOUD_PUSH_DEBOUNCE_MS = 800;

let cloudSyncQueue: Promise<void> = Promise.resolve();
let cloudPushDebounceTimer: number | null = null;

const enqueueCloudSyncTask = <T>(task: () => Promise<T>): Promise<T> => {
  const next = cloudSyncQueue.then(task, task);
  cloudSyncQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
};

const scheduleCloudPush = (getState: () => HostState): void => {
  if (cloudPushDebounceTimer !== null) {
    window.clearTimeout(cloudPushDebounceTimer);
  }

  cloudPushDebounceTimer = window.setTimeout(() => {
    cloudPushDebounceTimer = null;
    void getState().syncPushToCloud();
  }, CLOUD_PUSH_DEBOUNCE_MS);
};

export const useHostStore = create<HostState>((set, get) => ({
  appView: 'locked',
  hosts: [],
  identities: [],
  snippets: [],
  vaultVersion: null,
  vaultUpdatedAt: null,
  isUnlocking: false,
  unlockError: null,
  isSavingVault: false,
  saveError: null,
  cloudSyncSession: initialCloudSyncSession,
  cloudSyncVersion: null,
  cloudSyncLastAt: null,
  cloudDevices: [],
  isLoadingCloudDevices: false,
  isSyncingCloud: false,
  cloudSyncError: null,
  activeSessions: [],
  activeSessionId: null,
  isConnectingTerminal: false,
  terminalError: null,
  currentStep: 1,
  basicInfo: initialBasicInfo,
  authConfig: initialAuthConfig,
  advancedOptions: initialAdvancedOptions,
  submittedHost: null,
  unlockVault: async (masterPassword: string) => {
    if (!masterPassword.trim()) {
      set({ unlockError: '请输入主密码。' });
      return;
    }

    set({ isUnlocking: true, unlockError: null });
    try {
      const response = await unlockAndLoad(masterPassword);
      const normalized = normalizeVaultSnapshot({
        hosts: response.hosts,
        identities: response.identities,
        snippets: response.snippets
      });
      const cloudSession = readCloudSyncSession();
      set({
        hosts: normalized.hosts,
        identities: normalized.identities,
        snippets: normalized.snippets,
        vaultVersion: response.version,
        vaultUpdatedAt: response.updatedAt,
        appView: 'dashboard',
        isUnlocking: false,
        unlockError: null,
        activeSessions: [],
        activeSessionId: null,
        terminalError: null,
        saveError: null,
        cloudSyncSession: cloudSession,
        cloudSyncVersion: null,
        cloudSyncLastAt: null,
        cloudDevices: [],
        isLoadingCloudDevices: false,
        cloudSyncError: null
      });
      if (normalized.discarded > 0) {
        toast.warning(`检测到 ${normalized.discarded} 条异常配置，已自动忽略。`);
      }

      if (cloudSession) {
        void Promise.all([get().syncPullFromCloud(), get().loadCloudDevices()]);
      }
    } catch (error) {
      const fallback = '解锁失败，请检查主密码后重试。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isUnlocking: false,
        appView: 'locked',
        unlockError: message || fallback,
        snippets: [],
        vaultVersion: null,
        vaultUpdatedAt: null,
        cloudSyncVersion: null,
        cloudSyncLastAt: null,
        cloudDevices: [],
        isLoadingCloudDevices: false
      });
    }
  },
  lockVault: async () => {
    if (cloudPushDebounceTimer !== null) {
      window.clearTimeout(cloudPushDebounceTimer);
      cloudPushDebounceTimer = null;
    }
    const state = get();
    const sessions = [...state.activeSessions];
    for (const session of sessions) {
      try {
        await sshDisconnect(session.id);
      } catch (_error) {
        // Ignore disconnect failures while forcing vault lock.
      }
    }
    try {
      await clearVaultSession();
    } catch (_error) {
      // Ignore session clear failures and continue locking UI.
    }

    set({
      appView: 'locked',
      hosts: [],
      identities: [],
      snippets: [],
      vaultVersion: null,
      vaultUpdatedAt: null,
      cloudSyncVersion: null,
      cloudSyncLastAt: null,
      cloudDevices: [],
      isLoadingCloudDevices: false,
      activeSessions: [],
      activeSessionId: null,
      terminalError: null,
      currentStep: 1,
      basicInfo: initialBasicInfo,
      authConfig: initialAuthConfig,
      advancedOptions: initialAdvancedOptions,
      submittedHost: null,
      isSavingVault: false,
      saveError: null
    });
  },
  registerCloudAccount: async (apiBaseUrl, email, password) => {
    set({ isSyncingCloud: true, cloudSyncError: null });
    try {
      const session = await registerCloudSync(apiBaseUrl, email, password);
      set({
        cloudSyncSession: session,
        cloudSyncVersion: null,
        cloudSyncLastAt: null,
        cloudDevices: [],
        isLoadingCloudDevices: false,
        isSyncingCloud: false,
        cloudSyncError: null
      });
      if (get().appView === 'dashboard') {
        await Promise.all([get().syncPullFromCloud(), get().loadCloudDevices()]);
      }
      toast.success('私有云账号注册成功');
    } catch (error) {
      const fallback = '注册同步账号失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSyncingCloud: false,
        cloudSyncError: message || fallback
      });
      throw new Error(message || fallback);
    }
  },
  loginCloudAccount: async (apiBaseUrl, email, password) => {
    set({ isSyncingCloud: true, cloudSyncError: null });
    try {
      const session = await loginCloudSync(apiBaseUrl, email, password);
      set({
        cloudSyncSession: session,
        cloudSyncVersion: null,
        cloudSyncLastAt: null,
        cloudDevices: [],
        isLoadingCloudDevices: false,
        isSyncingCloud: false,
        cloudSyncError: null
      });
      if (get().appView === 'dashboard') {
        await Promise.all([get().syncPullFromCloud(), get().loadCloudDevices()]);
      }
      toast.success('私有云同步已连接');
    } catch (error) {
      const fallback = '同步登录失败，请检查账号或密码。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSyncingCloud: false,
        cloudSyncError: message || fallback
      });
      throw new Error(message || fallback);
    }
  },
  logoutCloudAccount: () => {
    clearCloudSyncSession();
    set({
      cloudSyncSession: null,
      cloudSyncVersion: null,
      cloudSyncLastAt: null,
      cloudDevices: [],
      isLoadingCloudDevices: false,
      cloudSyncError: null
    });
  },
  loadCloudDevices: async () => {
    const state = get();
    const session = state.cloudSyncSession ?? readCloudSyncSession();
    if (!session || state.appView !== 'dashboard') {
      return;
    }

    set({ isLoadingCloudDevices: true, cloudSyncError: null });
    try {
      const devices = await listCloudDevices(session);
      set({
        cloudSyncSession: session,
        cloudDevices: devices,
        isLoadingCloudDevices: false,
        cloudSyncError: null
      });
    } catch (error) {
      const fallback = '加载设备列表失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isLoadingCloudDevices: false,
        cloudSyncError: message || fallback
      });
    }
  },
  revokeCloudDevice: async (deviceId) => {
    const state = get();
    const session = state.cloudSyncSession ?? readCloudSyncSession();
    if (!session || state.appView !== 'dashboard') {
      throw new Error('请先登录同步账号。');
    }

    set({ isLoadingCloudDevices: true, cloudSyncError: null });
    try {
      const isCurrentTarget = state.cloudDevices.some(
        (device) => device.id === deviceId && device.isCurrent
      );
      await logoutCloudDevice(session, deviceId);
      if (isCurrentTarget) {
        clearCloudSyncSession();
        set({
          cloudSyncSession: null,
          cloudSyncVersion: null,
          cloudSyncLastAt: null,
          cloudDevices: [],
          isLoadingCloudDevices: false,
          cloudSyncError: null
        });
        toast.message('当前设备已退出云同步登录。');
        return;
      }

      const devices = await listCloudDevices(session);
      set({
        cloudSyncSession: session,
        cloudDevices: devices,
        isLoadingCloudDevices: false,
        cloudSyncError: null
      });
      toast.success('设备已退出登录。');
    } catch (error) {
      const fallback = '退出设备失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isLoadingCloudDevices: false,
        cloudSyncError: message || fallback
      });
      throw new Error(message || fallback);
    }
  },
  revokeAllCloudDevices: async () => {
    const state = get();
    const session = state.cloudSyncSession ?? readCloudSyncSession();
    if (!session || state.appView !== 'dashboard') {
      throw new Error('请先登录同步账号。');
    }

    set({ isLoadingCloudDevices: true, cloudSyncError: null });
    try {
      await logoutAllCloudDevices(session);
      clearCloudSyncSession();
      set({
        cloudSyncSession: null,
        cloudSyncVersion: null,
        cloudSyncLastAt: null,
        cloudDevices: [],
        isLoadingCloudDevices: false,
        cloudSyncError: null
      });
      toast.success('已退出所有设备。');
    } catch (error) {
      const fallback = '退出所有设备失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isLoadingCloudDevices: false,
        cloudSyncError: message || fallback
      });
      throw new Error(message || fallback);
    }
  },
  syncPushToCloud: async () => {
    return enqueueCloudSyncTask(async () => {
      const state = get();
      const session = state.cloudSyncSession ?? readCloudSyncSession();
      if (!session || state.appView !== 'dashboard') {
        return;
      }

      set({ isSyncingCloud: true, cloudSyncError: null });
      try {
        const localBlob = await exportVaultSyncBlob();
        const status = await getCloudSyncStatus(session);
        const pushResult = await pushCloudSyncBlob(session, {
          version: status.hasData ? status.version : 0,
          encryptedBlobBase64: localBlob.encryptedBlobBase64
        });
        set({
          cloudSyncSession: session,
          cloudSyncVersion: pushResult.acceptedVersion,
          cloudSyncLastAt: pushResult.updatedAt,
          vaultVersion: localBlob.version,
          vaultUpdatedAt: localBlob.updatedAt,
          isSyncingCloud: false,
          cloudSyncError: null
        });
      } catch (error) {
        if (error instanceof CloudSyncConflictError) {
          const latest = error.latest;
          if (latest?.hasData && latest.encryptedBlobBase64 && typeof latest.version === 'number') {
            try {
              const imported = await importVaultSyncBlob(latest.encryptedBlobBase64);
              const normalized = normalizeVaultSnapshot({
                hosts: imported.hosts,
                identities: imported.identities,
                snippets: imported.snippets
              });
              set({
                cloudSyncSession: session,
                cloudSyncVersion: latest.version,
                cloudSyncLastAt: latest.updatedAt ?? null,
                hosts: normalized.hosts,
                identities: normalized.identities,
                snippets: normalized.snippets,
                vaultVersion: imported.version,
                vaultUpdatedAt: imported.updatedAt,
                isSyncingCloud: false,
                cloudSyncError: null
              });
              if (normalized.discarded > 0) {
                toast.warning(`云端恢复时忽略了 ${normalized.discarded} 条异常配置。`);
              }
              toast.message('检测到云端有更新，已自动合并至最新版本。');
              return;
            } catch (importError) {
              const fallback = '云端冲突恢复失败，请手动执行拉取。';
              const message = importError instanceof Error ? importError.message : fallback;
              set({
                isSyncingCloud: false,
                cloudSyncError: message || fallback
              });
              return;
            }
          }
        }
        const fallback = '自动上传云端失败。';
        const message = error instanceof Error ? error.message : fallback;
        set({
          isSyncingCloud: false,
          cloudSyncError: message || fallback
        });
      }
    });
  },
  syncPullFromCloud: async () => {
    return enqueueCloudSyncTask(async () => {
      const state = get();
      const session = state.cloudSyncSession ?? readCloudSyncSession();
      if (!session || state.appView !== 'dashboard') {
        return;
      }

      set({ isSyncingCloud: true, cloudSyncError: null });
      try {
        const status = await getCloudSyncStatus(session);
        if (!status.hasData) {
          set({
            cloudSyncSession: session,
            cloudSyncVersion: 0,
            cloudSyncLastAt: status.updatedAt ?? null,
            isSyncingCloud: false,
            cloudSyncError: null
          });
          return;
        }

        const localCloudVersion = get().cloudSyncVersion ?? 0;
        if (status.version <= localCloudVersion) {
          set({
            cloudSyncSession: session,
            cloudSyncVersion: status.version,
            cloudSyncLastAt: status.updatedAt ?? get().cloudSyncLastAt,
            isSyncingCloud: false,
            cloudSyncError: null
          });
          return;
        }

        const remote = await pullCloudSyncBlob(session);
        if (!remote.hasData || !remote.encryptedBlobBase64 || typeof remote.version !== 'number') {
          set({
            cloudSyncSession: session,
            cloudSyncVersion: status.version,
            cloudSyncLastAt: status.updatedAt ?? get().cloudSyncLastAt,
            isSyncingCloud: false,
            cloudSyncError: null
          });
          return;
        }

        if (remote.version <= localCloudVersion) {
          set({
            cloudSyncSession: session,
            cloudSyncVersion: remote.version,
            cloudSyncLastAt: remote.updatedAt ?? status.updatedAt ?? get().cloudSyncLastAt,
            isSyncingCloud: false,
            cloudSyncError: null
          });
          return;
        }

        const imported = await importVaultSyncBlob(remote.encryptedBlobBase64);
        const normalized = normalizeVaultSnapshot({
          hosts: imported.hosts,
          identities: imported.identities,
          snippets: imported.snippets
        });
        set({
          cloudSyncSession: session,
          cloudSyncVersion: remote.version,
          cloudSyncLastAt: remote.updatedAt ?? status.updatedAt ?? get().cloudSyncLastAt,
          hosts: normalized.hosts,
          identities: normalized.identities,
          snippets: normalized.snippets,
          vaultVersion: imported.version,
          vaultUpdatedAt: imported.updatedAt,
          isSyncingCloud: false,
          cloudSyncError: null
        });
        if (normalized.discarded > 0) {
          toast.warning(`云端同步时忽略了 ${normalized.discarded} 条异常配置。`);
        }
        toast.success(`已从私有云同步到 v${imported.version}`);
      } catch (error) {
        const fallback = '自动拉取云端失败。';
        const message = error instanceof Error ? error.message : fallback;
        set({
          isSyncingCloud: false,
          cloudSyncError: message || fallback
        });
      }
    });
  },
  setHosts: (hosts) => {
    const normalized = normalizeVaultSnapshot({
      hosts,
      identities: get().identities,
      snippets: get().snippets
    });
    set({
      hosts: normalized.hosts,
      identities: normalized.identities,
      snippets: normalized.snippets
    });
  },
  setIdentities: (identities) => {
    const normalized = normalizeVaultSnapshot({
      hosts: get().hosts,
      identities,
      snippets: get().snippets
    });
    set({
      hosts: normalized.hosts,
      identities: normalized.identities,
      snippets: normalized.snippets
    });
  },
  addIdentity: async (payload) => {
    const state = get();
    const normalizedName = payload.name.trim();
    const normalizedUsername = payload.username.trim();
    const nextIdentity: IdentityConfig = identitySchema.parse({
      id: createIdentityId(),
      name: normalizedName || `${normalizedUsername}@identity`,
      username: normalizedUsername,
      authConfig: payload.authConfig
    });
    const nextIdentities = [...state.identities, nextIdentity];

    set({
      identities: nextIdentities,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(state.hosts, nextIdentities, state.snippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success(`已新增身份：${nextIdentity.name}`);
      return nextIdentity;
    } catch (error) {
      const fallback = '身份已添加到当前会话，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
      throw new Error(message || fallback);
    }
  },
  addSnippet: async (payload) => {
    const state = get();
    const normalizedTags = Array.from(
      new Set(
        payload.tags
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
    const snippet: Snippet = snippetSchema.parse({
      id: createSnippetId(),
      title: payload.title,
      command: payload.command,
      tags: normalizedTags
    });

    const nextSnippets = [...state.snippets, snippet];
    set({
      snippets: nextSnippets,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(state.hosts, state.identities, nextSnippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success(`已添加指令：${snippet.title}`);
    } catch (error) {
      const fallback = '指令已添加到当前会话，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
    }
  },
  updateSnippet: async (snippetId, payload) => {
    const state = get();
    const target = state.snippets.find((item) => item.id === snippetId);
    if (!target) {
      throw new Error('未找到要更新的指令片段。');
    }

    const normalizedTags = Array.from(
      new Set(
        payload.tags
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );

    const nextSnippet: Snippet = snippetSchema.parse({
      id: target.id,
      title: payload.title,
      command: payload.command,
      tags: normalizedTags
    });
    const nextSnippets = state.snippets.map((item) => (item.id === target.id ? nextSnippet : item));

    set({
      snippets: nextSnippets,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(state.hosts, state.identities, nextSnippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success(`已更新指令：${nextSnippet.title}`);
    } catch (error) {
      const fallback = '指令已更新到当前会话，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
    }
  },
  deleteSnippet: async (snippetId) => {
    const state = get();
    const target = state.snippets.find((item) => item.id === snippetId);
    if (!target) {
      throw new Error('未找到要删除的指令片段。');
    }

    const nextSnippets = state.snippets.filter((item) => item.id !== snippetId);
    set({
      snippets: nextSnippets,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(state.hosts, state.identities, nextSnippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success(`已删除指令：${target.title}`);
    } catch (error) {
      const fallback = '指令已从当前会话移除，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
    }
  },
  updateHostAndIdentity: async (hostId, payload) => {
    const state = get();
    const hostIndex = state.hosts.findIndex((item) => buildHostId(item) === hostId);
    if (hostIndex < 0) {
      throw new Error('未找到要编辑的主机，请刷新后重试。');
    }

    const currentHost = state.hosts[hostIndex];
    if (!currentHost) {
      throw new Error('未找到要编辑的主机，请刷新后重试。');
    }
    const currentIdentity = state.identities.find((item) => item.id === currentHost.identityId);
    if (!currentIdentity) {
      throw new Error('未找到该主机关联的身份配置。');
    }

    const normalizedAddress = payload.basicInfo.address.trim();
    const normalizedPort = Math.round(payload.basicInfo.port);
    const normalizedName =
      payload.basicInfo.name.trim() || `${normalizedAddress}:${normalizedPort}`;
    const normalizedDescription = payload.basicInfo.description.trim();
    const nextTags = parseTags(payload.basicInfo.tagsText);

    const updatedHost: HostConfig = finalHostSchema.parse({
      basicInfo: {
        name: normalizedName,
        address: normalizedAddress,
        port: normalizedPort,
        description: normalizedDescription
      },
      identityId: currentHost.identityId,
      advancedOptions: {
        ...currentHost.advancedOptions,
        tags: nextTags
      }
    });

    const normalizedIdentityUsername = payload.identity.username.trim();
    const normalizedIdentityName =
      payload.identity.name.trim() || `${normalizedIdentityUsername}@${normalizedAddress}`;
    const updatedIdentity: IdentityConfig = identitySchema.parse({
      ...currentIdentity,
      name: normalizedIdentityName,
      username: normalizedIdentityUsername,
      authConfig: payload.identity.authConfig
    });

    const nextHosts = state.hosts.map((item, index) => (index === hostIndex ? updatedHost : item));
    const nextIdentities = state.identities.map((item) =>
      item.id === updatedIdentity.id ? updatedIdentity : item
    );

    const newHostId = buildHostId(updatedHost);
    const title = updatedHost.basicInfo.name || `${updatedHost.basicInfo.address}:${updatedHost.basicInfo.port}`;
    const nextSessions = state.activeSessions.map((session) => {
      if (session.hostId !== hostId) {
        return session;
      }
      return {
        ...session,
        hostId: newHostId,
        title
      };
    });

    set({
      hosts: nextHosts,
      identities: nextIdentities,
      activeSessions: nextSessions,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(nextHosts, nextIdentities, state.snippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success('主机信息已更新', {
        description: '更改已写入本地加密金库。'
      });
    } catch (error) {
      const fallback = '主机编辑已应用到当前会话，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
    }
  },
  deleteHost: async (hostId) => {
    const state = get();
    const targetHost = state.hosts.find((item) => buildHostId(item) === hostId);
    if (!targetHost) {
      throw new Error('未找到要删除的主机。');
    }

    const sessionsToClose = state.activeSessions.filter((session) => session.hostId === hostId);
    for (const session of sessionsToClose) {
      try {
        await sshDisconnect(session.id);
      } catch (_error) {
        // Best effort close.
      }
    }

    const nextHosts = state.hosts.filter((item) => buildHostId(item) !== hostId);
    const identityStillUsed = nextHosts.some((item) => item.identityId === targetHost.identityId);
    const nextIdentities = identityStillUsed
      ? state.identities
      : state.identities.filter((item) => item.id !== targetHost.identityId);

    let nextSessions = state.activeSessions;
    let nextActiveSessionId = state.activeSessionId;
    for (const session of sessionsToClose) {
      const next = removeSessionAndPickActive(nextSessions, session.id, nextActiveSessionId);
      nextSessions = next.sessions;
      nextActiveSessionId = next.activeSessionId;
    }

    set({
      hosts: nextHosts,
      identities: nextIdentities,
      activeSessions: nextSessions,
      activeSessionId: nextActiveSessionId,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(nextHosts, nextIdentities, state.snippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success(`已删除主机：${targetHost.basicInfo.name}`);
    } catch (error) {
      const fallback = '主机已从当前界面移除，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
    }
  },
  updateIdentity: async (identity) => {
    const state = get();
    const nextIdentities = state.identities.map((item) =>
      item.id === identity.id ? identity : item
    );
    set({ identities: nextIdentities, isSavingVault: true, saveError: null });
    try {
      const saveResult = await saveVault(state.hosts, nextIdentities, state.snippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
    } catch (error) {
      const fallback = '身份更新已应用到当前会话，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({ isSavingVault: false, saveError: message || fallback });
    }
  },
  switchView: (view) => set({ appView: view }),
  openDetachedSession: async (hostId) => {
    const state = get();
    const host = state.hosts.find((item) => buildHostId(item) === hostId);
    if (!host) {
      throw new Error('未找到对应主机，无法创建分屏会话。');
    }
    const identity = state.identities.find((item) => item.id === host.identityId);
    if (!identity) {
      throw new Error('未找到主机关联身份，请检查身份配置后重试。');
    }

    const proxyChain = buildProxyChain(host, identity, state.hosts, state.identities);
    const response = await sshConnect(host, identity, proxyChain);
    const title = host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`;
    return {
      id: response.sessionId,
      title,
      hostId
    };
  },
  openTerminal: async (host) => {
    set({ isConnectingTerminal: true, terminalError: null });
    try {
      const state = get();
      const identity = state.identities.find((item) => item.id === host.identityId);
      if (!identity) {
        throw new Error('未找到主机关联身份，请检查身份配置后重试。');
      }

      const proxyChain = buildProxyChain(host, identity, state.hosts, state.identities);
      const response = await sshConnect(host, identity, proxyChain);
      const hostId = buildHostId(host);
      const title = host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`;
      set((state) => ({
        activeSessions: [
          ...state.activeSessions,
          {
            id: response.sessionId,
            title,
            hostId
          }
        ],
        activeSessionId: response.sessionId,
        isConnectingTerminal: false,
        terminalError: null
      }));
      return true;
    } catch (error) {
      const fallback = '终端连接失败，请检查主机地址与身份认证配置。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isConnectingTerminal: false,
        terminalError: message || fallback
      });
      return false;
    }
  },
  openNewTab: async () => {
    const state = get();
    if (state.hosts.length === 0) {
      set({ terminalError: '当前没有可用主机，无法新建终端标签。' });
      return;
    }

    const fallbackHost = state.hosts[0];
    if (!fallbackHost) {
      set({ terminalError: '当前没有可用主机，无法新建终端标签。' });
      return;
    }

    let targetHost: HostConfig = fallbackHost;
    if (state.activeSessionId) {
      const activeSession = state.activeSessions.find(
        (session) => session.id === state.activeSessionId
      );
      if (activeSession) {
        const matched = state.hosts.find((host) => buildHostId(host) === activeSession.hostId);
        if (matched) {
          targetHost = matched;
        }
      }
    }

    await state.openTerminal(targetHost);
  },
  setActiveSession: (sessionId) => {
    set((state) => {
      const exists = state.activeSessions.some((session) => session.id === sessionId);
      if (!exists) {
        return {};
      }
      return { activeSessionId: sessionId, terminalError: null };
    });
  },
  closeSession: async (sessionId) => {
    markManualClosing(sessionId);
    try {
      await sshDisconnect(sessionId);
    } catch (_error) {
      // Ignore disconnect failures and still close local tab state.
    }

    set((state) => {
      const next = removeSessionAndPickActive(
        state.activeSessions,
        sessionId,
        state.activeSessionId
      );
      return {
        activeSessions: next.sessions,
        activeSessionId: next.activeSessionId
      };
    });
  },
  handleSessionClosed: (sessionId) => {
    const isManual = consumeManualClosing(sessionId);
    set((state) => {
      const next = removeSessionAndPickActive(
        state.activeSessions,
        sessionId,
        state.activeSessionId
      );
      return {
        activeSessions: next.sessions,
        activeSessionId: next.activeSessionId
      };
    });
    return isManual ? 'manual' : 'abnormal';
  },
  closeTerminal: async () => {
    const state = get();
    if (!state.activeSessionId) {
      set({ activeSessionId: null });
      return;
    }

    await state.closeSession(state.activeSessionId);
  },
  setTerminalError: (message) => set({ terminalError: message }),
  setStep: (step) => set({ currentStep: step }),
  nextStep: () =>
    set((state) => ({
      currentStep: state.currentStep < 3 ? (state.currentStep + 1) as WizardStep : state.currentStep
    })),
  prevStep: () =>
    set((state) => ({
      currentStep: state.currentStep > 1 ? (state.currentStep - 1) as WizardStep : state.currentStep
    })),
  updateBasicInfo: (payload) => set({ basicInfo: payload }),
  updateAuthConfig: (payload) => set({ authConfig: payload }),
  updateAdvancedOptions: (payload) => set({ advancedOptions: payload }),
  applyDemoHostTemplate: () =>
    set({
      currentStep: 1,
      basicInfo: {
        ...initialBasicInfo,
        name: '我的第一台服务器',
        address: '127.0.0.1',
        port: 22,
        description: '本地 Demo 服务器',
        identityMode: 'new',
        identityName: '默认身份',
        identityUsername: 'root'
      },
      authConfig: {
        ...initialAuthConfig,
        method: 'password',
        password: ''
      },
      advancedOptions: { ...initialAdvancedOptions },
      submittedHost: null
    }),
  submitHost: async () => {
    const state = get();
    let identityId = state.basicInfo.identityId.trim();
    let nextIdentities = state.identities;
    const normalizedAddress = state.basicInfo.address.trim();
    const normalizedPort = Math.round(state.basicInfo.port);
    const normalizedHostName =
      state.basicInfo.name.trim() || `${normalizedAddress}:${normalizedPort}`;
    const normalizedDescription = state.basicInfo.description.trim();

    if (state.basicInfo.identityMode === 'new') {
      const normalizedIdentityUsername = state.basicInfo.identityUsername.trim();
      const normalizedIdentityName =
        state.basicInfo.identityName.trim() || `${normalizedIdentityUsername}@${normalizedAddress}`;
      const newIdentity: IdentityConfig = identitySchema.parse({
        id: createIdentityId(),
        name: normalizedIdentityName,
        username: normalizedIdentityUsername,
        authConfig: state.authConfig
      });
      identityId = newIdentity.id;
      nextIdentities = [...state.identities, newIdentity];
    } else {
      const existingIdentity = state.identities.find((item) => item.id === identityId);
      if (!existingIdentity) {
        throw new Error('请选择一个有效的已有身份。');
      }
    }

    const hostConfig: HostConfig = {
      basicInfo: {
        ...state.basicInfo,
        name: normalizedHostName,
        address: normalizedAddress,
        port: normalizedPort,
        description: normalizedDescription
      },
      identityId,
      advancedOptions: {
        jumpHost: state.advancedOptions.jumpHost,
        proxyJumpHostId: state.advancedOptions.proxyJumpHostId,
        connectionTimeout: state.advancedOptions.connectionTimeout,
        keepAliveEnabled: state.advancedOptions.keepAliveEnabled,
        keepAliveInterval: state.advancedOptions.keepAliveInterval,
        compression: state.advancedOptions.compression,
        strictHostKeyChecking: state.advancedOptions.strictHostKeyChecking,
        tags: parseTags(state.advancedOptions.tagsText)
      }
    };

    const parsed = finalHostSchema.parse(hostConfig);
    const nextHosts = [...state.hosts, parsed];

    set({
      submittedHost: parsed,
      currentStep: 3,
      hosts: nextHosts,
      identities: nextIdentities,
      isSavingVault: true,
      saveError: null
    });

    try {
      const saveResult = await saveVault(nextHosts, nextIdentities, state.snippets);
      set({
        isSavingVault: false,
        saveError: null,
        vaultVersion: saveResult.version,
        vaultUpdatedAt: saveResult.updatedAt
      });
      scheduleCloudPush(get);
      toast.success('主机配置已保存到金库', {
        description: '本地加密文件已更新。'
      });
    } catch (error) {
      const fallback = '主机已添加到当前会话，但写入本地金库失败，请检查磁盘空间或目录权限。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isSavingVault: false,
        saveError: message || fallback
      });
      toast.error(message || fallback);
    }

    return parsed;
  },
  reset: () =>
    set({
      currentStep: 1,
      basicInfo: initialBasicInfo,
      authConfig: initialAuthConfig,
      advancedOptions: initialAdvancedOptions,
      submittedHost: null,
      terminalError: null
    })
}));
