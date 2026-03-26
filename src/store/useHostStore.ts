import { create } from 'zustand';
import { toast } from 'sonner';
import {
  finalHostSchema,
  identitySchema,
  type Step1FormValues,
  type Step2FormValues,
  type Step3FormValues
} from '../schemas/hostSchemas';
import type { HostConfig, IdentityConfig } from '../types/host';
import { saveVault, unlockAndLoad } from '../services/vault';
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
  isUnlocking: boolean;
  unlockError: string | null;
  isSavingVault: boolean;
  saveError: string | null;
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
  setHosts: (hosts: HostConfig[]) => void;
  setIdentities: (identities: IdentityConfig[]) => void;
  updateHostAndIdentity: (hostId: string, payload: HostEditPayload) => Promise<void>;
  deleteHost: (hostId: string) => Promise<void>;
  updateIdentity: (identity: IdentityConfig) => Promise<void>;
  switchView: (view: AppView) => void;
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
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `identity-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export const useHostStore = create<HostState>((set, get) => ({
  appView: 'locked',
  hosts: [],
  identities: [],
  isUnlocking: false,
  unlockError: null,
  isSavingVault: false,
  saveError: null,
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
      set({
        hosts: response.hosts,
        identities: response.identities,
        appView: 'dashboard',
        isUnlocking: false,
        unlockError: null,
        activeSessions: [],
        activeSessionId: null,
        terminalError: null,
        saveError: null
      });
    } catch (error) {
      const fallback = '解锁失败，请检查主密码后重试。';
      const message = error instanceof Error ? error.message : fallback;
      set({
        isUnlocking: false,
        appView: 'locked',
        unlockError: message || fallback
      });
    }
  },
  lockVault: async () => {
    const state = get();
    const sessions = [...state.activeSessions];
    for (const session of sessions) {
      try {
        await sshDisconnect(session.id);
      } catch (_error) {
        // Ignore disconnect failures while forcing vault lock.
      }
    }

    set({
      appView: 'locked',
      hosts: [],
      identities: [],
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
  setHosts: (hosts) => set({ hosts }),
  setIdentities: (identities) => set({ identities }),
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

    const updatedHost: HostConfig = finalHostSchema.parse({
      basicInfo: {
        name: normalizedName,
        address: normalizedAddress,
        port: normalizedPort,
        description: normalizedDescription
      },
      identityId: currentHost.identityId,
      advancedOptions: currentHost.advancedOptions
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
      await saveVault(nextHosts, nextIdentities);
      set({
        isSavingVault: false,
        saveError: null
      });
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
      await saveVault(nextHosts, nextIdentities);
      set({
        isSavingVault: false,
        saveError: null
      });
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
      await saveVault(state.hosts, nextIdentities);
      set({ isSavingVault: false, saveError: null });
    } catch (error) {
      const fallback = '身份更新已应用到当前会话，但写入本地金库失败。';
      const message = error instanceof Error ? error.message : fallback;
      set({ isSavingVault: false, saveError: message || fallback });
    }
  },
  switchView: (view) => set({ appView: view }),
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
      await saveVault(nextHosts, nextIdentities);
      set({
        isSavingVault: false,
        saveError: null
      });
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
