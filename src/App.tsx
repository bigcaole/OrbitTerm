import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { appWindow } from '@tauri-apps/api/window';
import { Toaster, toast } from 'sonner';
import { Step1 } from './components/wizard/Step1';
import { Step2 } from './components/wizard/Step2';
import { Step3 } from './components/wizard/Step3';
import { StepIndicator } from './components/wizard/StepIndicator';
import { UnlockScreen } from './components/UnlockScreen';
import { FirstRunOnboarding } from './components/FirstRunOnboarding';
import { HostEditDialog, type HostEditFormValues } from './components/HostEditDialog';
import { CommandPalette, type CommandPaletteItem } from './components/CommandPalette';
import {
  OrbitTerminal,
  type SplitDirection,
  type TerminalLayoutNode,
  type TerminalSplitPane
} from './components/terminal/OrbitTerminal';
import { OrbitAiAssistant } from './components/terminal/OrbitAiAssistant';
import { OrbitInspector } from './components/terminal/OrbitInspector';
import { SnippetsPanel } from './components/terminal/SnippetsPanel';
import { SftpManager } from './components/sftp/SftpManager';
import { TransferCenter } from './components/transfer/TransferCenter';
import { AboutOrbitTermModal } from './components/settings/AboutOrbitTermModal';
import { SettingsDrawer, type SettingsCategory } from './components/settings/SettingsDrawer';
import { CloudAuthModal } from './components/cloud/CloudAuthModal';
import { useHostStore } from './store/useHostStore';
import { useUiSettingsStore } from './store/useUiSettingsStore';
import { useTransferStore } from './store/useTransferStore';
import { useAppLogStore } from './store/useAppLogStore';
import { aiExplainSshError } from './services/ai';
import type { HealthCheckResponse, SshDiagnosticLogEvent } from './services/inspector';
import { runHealthCheck } from './services/inspector';
import { sshDisconnect, sshQueryPwd, sshSetPulseActivity, sshWrite, type SshSysStatusEvent } from './services/ssh';
import type { SftpTransferProgressEvent } from './services/sftp';
import { getAppVersion } from './services/appInfo';
import {
  checkReleaseAvailability,
  readReleaseNoticeState,
  rememberDailyLockCheck,
  type ReleaseNoticeState,
  wasDailyLockChecked,
  writeReleaseNoticeState
} from './services/updater';
import { resolveThemePreset } from './theme/orbitTheme';
import { buildHostKey } from './utils/hostKey';
import { useI18n } from './i18n/useI18n';

type DashboardSection = 'hosts' | 'terminal';

interface SftpSyncRequest {
  sessionId: string;
  path: string;
  nonce: number;
}

type SessionSysStatus = SshSysStatusEvent['status'];

interface TabSplitWorkspace {
  root: TerminalLayoutNode;
  activePaneId: string;
  syncInput: boolean;
}

interface SplitMenuState {
  x: number;
  y: number;
  tabSessionId: string;
  paneId: string;
}

const toolbarButtonClass =
  'rounded-lg border border-slate-300 bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-white disabled:cursor-not-allowed disabled:opacity-55';
const darkPanelButtonClass =
  'rounded-lg border border-[#5a79a8] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]';
const SFTP_PANEL_MIN_WIDTH = 280;
const SFTP_PANEL_MAX_WIDTH = 680;
const IDLE_RELEASE_CHECK_MS = 5 * 60 * 1000;
const AUTO_PULL_INTERVAL_MS = 25_000;

const SETTINGS_SECTION_CATEGORY_MAP: Record<string, SettingsCategory> = {
  'settings-font': 'settings',
  'settings-acrylic': 'settings',
  'settings-theme': 'settings',
  'settings-security': 'settings',
  'settings-identity': 'files',
  'settings-sync': 'profile',
  'settings-devices': 'profile',
  'settings-about': 'other'
};

const buildLocalDayLabel = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, value));
};

const createPaneId = (tabSessionId: string): string => {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `pane-${tabSessionId}-${randomPart}`;
};

const createSplitId = (): string => {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `split-${randomPart}`;
};

const createPaneNode = (pane: TerminalSplitPane): TerminalLayoutNode => ({
  type: 'pane',
  pane
});

const createDefaultWorkspace = (session: {
  id: string;
  hostId: string;
  title: string;
}): TabSplitWorkspace => {
  const paneId = `pane-${session.id}`;
  const pane: TerminalSplitPane = {
    id: paneId,
    sessionId: session.id,
    hostId: session.hostId,
    title: session.title
  };
  return {
    root: createPaneNode(pane),
    activePaneId: paneId,
    syncInput: false
  };
};

const collectWorkspacePanes = (node: TerminalLayoutNode): TerminalSplitPane[] => {
  if (node.type === 'pane') {
    return [node.pane];
  }
  return [...collectWorkspacePanes(node.first), ...collectWorkspacePanes(node.second)];
};

const hasPaneId = (node: TerminalLayoutNode, paneId: string): boolean => {
  if (node.type === 'pane') {
    return node.pane.id === paneId;
  }
  return hasPaneId(node.first, paneId) || hasPaneId(node.second, paneId);
};

const findPaneById = (node: TerminalLayoutNode, paneId: string): TerminalSplitPane | null => {
  if (node.type === 'pane') {
    return node.pane.id === paneId ? node.pane : null;
  }
  return findPaneById(node.first, paneId) ?? findPaneById(node.second, paneId);
};

const findPaneBySessionId = (node: TerminalLayoutNode, sessionId: string): TerminalSplitPane | null => {
  if (node.type === 'pane') {
    return node.pane.sessionId === sessionId ? node.pane : null;
  }
  return findPaneBySessionId(node.first, sessionId) ?? findPaneBySessionId(node.second, sessionId);
};

const updatePaneBySessionId = (
  node: TerminalLayoutNode,
  sessionId: string,
  patch: Partial<TerminalSplitPane>
): TerminalLayoutNode => {
  if (node.type === 'pane') {
    if (node.pane.sessionId !== sessionId) {
      return node;
    }
    return {
      ...node,
      pane: {
        ...node.pane,
        ...patch
      }
    };
  }

  const nextFirst = updatePaneBySessionId(node.first, sessionId, patch);
  const nextSecond = updatePaneBySessionId(node.second, sessionId, patch);
  if (nextFirst === node.first && nextSecond === node.second) {
    return node;
  }
  return {
    ...node,
    first: nextFirst,
    second: nextSecond
  };
};

const replacePaneWithSplit = (
  node: TerminalLayoutNode,
  targetPaneId: string,
  direction: SplitDirection,
  nextPane: TerminalSplitPane
): TerminalLayoutNode => {
  if (node.type === 'pane') {
    if (node.pane.id !== targetPaneId) {
      return node;
    }
    return {
      type: 'split',
      id: createSplitId(),
      direction,
      sizes: [50, 50],
      first: node,
      second: createPaneNode(nextPane)
    };
  }

  const nextFirst = replacePaneWithSplit(node.first, targetPaneId, direction, nextPane);
  if (nextFirst !== node.first) {
    return {
      ...node,
      first: nextFirst
    };
  }
  const nextSecond = replacePaneWithSplit(node.second, targetPaneId, direction, nextPane);
  if (nextSecond !== node.second) {
    return {
      ...node,
      second: nextSecond
    };
  }
  return node;
};

const removePaneFromLayout = (
  node: TerminalLayoutNode,
  targetPaneId: string
): { nextNode: TerminalLayoutNode | null; removedPane: TerminalSplitPane | null } => {
  if (node.type === 'pane') {
    if (node.pane.id === targetPaneId) {
      return {
        nextNode: null,
        removedPane: node.pane
      };
    }
    return {
      nextNode: node,
      removedPane: null
    };
  }

  const leftResult = removePaneFromLayout(node.first, targetPaneId);
  if (leftResult.removedPane) {
    if (!leftResult.nextNode) {
      return {
        nextNode: node.second,
        removedPane: leftResult.removedPane
      };
    }
    return {
      nextNode: {
        ...node,
        first: leftResult.nextNode
      },
      removedPane: leftResult.removedPane
    };
  }

  const rightResult = removePaneFromLayout(node.second, targetPaneId);
  if (rightResult.removedPane) {
    if (!rightResult.nextNode) {
      return {
        nextNode: node.first,
        removedPane: rightResult.removedPane
      };
    }
    return {
      nextNode: {
        ...node,
        second: rightResult.nextNode
      },
      removedPane: rightResult.removedPane
    };
  }

  return {
    nextNode: node,
    removedPane: null
  };
};

const formatRate = (bytesPerSec: number): string => {
  const value = Number.isFinite(bytesPerSec) ? Math.max(0, bytesPerSec) : 0;
  if (value < 1024) {
    return `${value.toFixed(0)} B/s`;
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB/s`;
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  }
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
};

const scoreSearchField = (query: string, rawValue: string): number => {
  const value = rawValue.trim().toLowerCase();
  if (!value) {
    return 0;
  }
  if (value === query) {
    return 220;
  }
  if (value.startsWith(query)) {
    return 160;
  }
  const index = value.indexOf(query);
  if (index >= 0) {
    return Math.max(50, 130 - index);
  }
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => value.includes(token))) {
    return 40;
  }
  return 0;
};

const scoreSearchFields = (query: string, values: string[]): number => {
  if (!query) {
    return 0;
  }
  let best = 0;
  let hitCount = 0;
  for (const value of values) {
    const score = scoreSearchField(query, value);
    if (score > 0) {
      hitCount += 1;
    }
    if (score > best) {
      best = score;
    }
  }
  return best + Math.min(36, hitCount * 12);
};

type PaletteRuntimeItem = CommandPaletteItem & {
  score: number;
  execute: () => Promise<void> | void;
};

interface PaletteSettingEntry {
  id: string;
  title: string;
  subtitle: string;
  keywords: string[];
  sectionId: string;
}

const PALETTE_SETTINGS_ENTRIES: ReadonlyArray<PaletteSettingEntry> = [
  {
    id: 'settings-font',
    title: '设置 · 终端字体',
    subtitle: '调整字体家族、字号与渲染显示',
    keywords: ['字体', '字号', 'font', 'nerd', 'terminal font'],
    sectionId: 'settings-font'
  },
  {
    id: 'settings-acrylic',
    title: '设置 · 毛玻璃与透明度',
    subtitle: '调整终端透明度、模糊与全局 Acrylic 参数',
    keywords: ['透明度', '模糊', 'acrylic', 'blur', 'glass'],
    sectionId: 'settings-acrylic'
  },
  {
    id: 'settings-theme',
    title: '设置 · 主题配色',
    subtitle: '切换 OrbitTerm 内置终端主题',
    keywords: ['主题', '配色', 'theme', 'solarized', 'dracula', 'monokai'],
    sectionId: 'settings-theme'
  },
  {
    id: 'settings-security',
    title: '设置 · 安全',
    subtitle: '自动锁定时长与安全策略',
    keywords: ['安全', '锁定', 'auto lock', 'vault'],
    sectionId: 'settings-security'
  },
  {
    id: 'settings-identity',
    title: '设置 · 身份管理与 SSH 密钥',
    subtitle: '生成密钥、部署公钥、导出私钥',
    keywords: ['身份', '密钥', 'ssh key', 'identity', 'ed25519', 'rsa'],
    sectionId: 'settings-identity'
  },
  {
    id: 'settings-sync',
    title: '设置 · 私有云同步',
    subtitle: '同步状态、手动拉取与会话信息',
    keywords: ['同步', 'cloud', 'push', 'pull', '状态'],
    sectionId: 'settings-sync'
  },
  {
    id: 'settings-devices',
    title: '设置 · 登录设备管理',
    subtitle: '查看在线设备与一键退出',
    keywords: ['设备', '登录设备', 'device', 'logout'],
    sectionId: 'settings-devices'
  },
  {
    id: 'settings-about',
    title: '设置 · 关于 OrbitTerm',
    subtitle: '版本信息与下载提示',
    keywords: ['关于', 'version', 'release', '更新'],
    sectionId: 'settings-about'
  }
];

function App(): JSX.Element {
  const { locale } = useI18n();
  const [isAiAssistantOpen, setIsAiAssistantOpen] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [commandPaletteQuery, setCommandPaletteQuery] = useState<string>('');
  const [commandPaletteActiveIndex, setCommandPaletteActiveIndex] = useState<number>(0);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>('settings');
  const [settingsFocusSectionId, setSettingsFocusSectionId] = useState<string | null>(null);
  const [settingsFocusSequence, setSettingsFocusSequence] = useState<number>(0);
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState<boolean>(false);
  const [dashboardSection, setDashboardSection] = useState<DashboardSection>('hosts');
  const [hostSearchQuery, setHostSearchQuery] = useState<string>('');
  const [activeTagFilter, setActiveTagFilter] = useState<string>('all');
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState<number>(0);
  const [isHostWizardOpen, setIsHostWizardOpen] = useState<boolean>(false);
  const [isNewTabModalOpen, setIsNewTabModalOpen] = useState<boolean>(false);
  const [selectedTabHostId, setSelectedTabHostId] = useState<string>('');
  const [releaseNotice, setReleaseNotice] = useState<ReleaseNoticeState>(() => readReleaseNoticeState());
  const [editingHostId, setEditingHostId] = useState<string | null>(null);
  const [isSyncPopoverOpen, setIsSyncPopoverOpen] = useState<boolean>(false);
  const [isSyncingPath, setIsSyncingPath] = useState<boolean>(false);
  const [sftpSyncRequest, setSftpSyncRequest] = useState<SftpSyncRequest | null>(null);
  const [isSftpCollapsed, setIsSftpCollapsed] = useState<boolean>(false);
  const [sftpPanelWidth, setSftpPanelWidth] = useState<number>(380);
  const [isResizingSplit, setIsResizingSplit] = useState<boolean>(false);
  const [reconnectMessage, setReconnectMessage] = useState<string | null>(null);
  const [sshDiagnosticLogs, setSshDiagnosticLogs] = useState<SshDiagnosticLogEvent[]>([]);
  const [healthReport, setHealthReport] = useState<HealthCheckResponse | null>(null);
  const [sysStatusBySession, setSysStatusBySession] = useState<Record<string, SessionSysStatus>>({});
  const [splitWorkspaces, setSplitWorkspaces] = useState<Record<string, TabSplitWorkspace>>({});
  const [splitMenu, setSplitMenu] = useState<SplitMenuState | null>(null);
  const [isCloudAuthModalOpen, setIsCloudAuthModalOpen] = useState<boolean>(false);
  const [skippedCloudAuthForCurrentUnlock, setSkippedCloudAuthForCurrentUnlock] =
    useState<boolean>(false);
  const [isCloseWindowPromptOpen, setIsCloseWindowPromptOpen] = useState<boolean>(false);
  const [rememberCloseActionChoice, setRememberCloseActionChoice] = useState<boolean>(false);

  const appView = useHostStore((state) => state.appView);
  const hosts = useHostStore((state) => state.hosts);
  const identities = useHostStore((state) => state.identities);
  const snippets = useHostStore((state) => state.snippets);
  const activeSessions = useHostStore((state) => state.activeSessions);
  const activeSessionId = useHostStore((state) => state.activeSessionId);
  const isConnectingTerminal = useHostStore((state) => state.isConnectingTerminal);
  const terminalError = useHostStore((state) => state.terminalError);
  const openTerminal = useHostStore((state) => state.openTerminal);
  const setActiveSession = useHostStore((state) => state.setActiveSession);
  const closeSession = useHostStore((state) => state.closeSession);
  const handleSessionClosed = useHostStore((state) => state.handleSessionClosed);
  const closeTerminal = useHostStore((state) => state.closeTerminal);
  const setTerminalError = useHostStore((state) => state.setTerminalError);
  const currentStep = useHostStore((state) => state.currentStep);
  const submittedHost = useHostStore((state) => state.submittedHost);
  const isSavingVault = useHostStore((state) => state.isSavingVault);
  const saveError = useHostStore((state) => state.saveError);
  const cloudSyncSession = useHostStore((state) => state.cloudSyncSession);
  const cloudSyncLastAt = useHostStore((state) => state.cloudSyncLastAt);
  const isSyncingCloud = useHostStore((state) => state.isSyncingCloud);
  const cloudSyncError = useHostStore((state) => state.cloudSyncError);
  const syncPullFromCloud = useHostStore((state) => state.syncPullFromCloud);
  const syncPushToCloud = useHostStore((state) => state.syncPushToCloud);
  const reset = useHostStore((state) => state.reset);
  const lockVault = useHostStore((state) => state.lockVault);
  const updateHostAndIdentity = useHostStore((state) => state.updateHostAndIdentity);
  const deleteHost = useHostStore((state) => state.deleteHost);
  const openDetachedSession = useHostStore((state) => state.openDetachedSession);
  const addSnippet = useHostStore((state) => state.addSnippet);
  const updateSnippet = useHostStore((state) => state.updateSnippet);
  const deleteSnippet = useHostStore((state) => state.deleteSnippet);

  const terminalFontSize = useUiSettingsStore((state) => state.terminalFontSize);
  const terminalFontFamily = useUiSettingsStore((state) => state.terminalFontFamily);
  const terminalOpacity = useUiSettingsStore((state) => state.terminalOpacity);
  const terminalBlur = useUiSettingsStore((state) => state.terminalBlur);
  const acrylicBlur = useUiSettingsStore((state) => state.acrylicBlur);
  const acrylicSaturation = useUiSettingsStore((state) => state.acrylicSaturation);
  const acrylicBrightness = useUiSettingsStore((state) => state.acrylicBrightness);
  const themePresetId = useUiSettingsStore((state) => state.themePresetId);
  const autoLockEnabled = useUiSettingsStore((state) => state.autoLockEnabled);
  const autoLockMinutes = useUiSettingsStore((state) => state.autoLockMinutes);
  const closeWindowAction = useUiSettingsStore((state) => state.closeWindowAction);
  const setCloseWindowAction = useUiSettingsStore((state) => state.setCloseWindowAction);
  const hasCompletedOnboarding = useUiSettingsStore((state) => state.hasCompletedOnboarding);
  const hostUsageStats = useUiSettingsStore((state) => state.hostUsageStats);
  const recordHostConnection = useUiSettingsStore((state) => state.recordHostConnection);
  const applyTransferProgressEvent = useTransferStore((state) => state.applyProgressEvent);
  const appLogs = useAppLogStore((state) => state.logs);
  const clearAppLogs = useAppLogStore((state) => state.clearLogs);

  const activeThemePreset = useMemo(() => resolveThemePreset(themePresetId), [themePresetId]);
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const syncLastText = useMemo(() => {
    if (!cloudSyncLastAt) {
      return '未完成云同步';
    }
    const date = new Date(cloudSyncLastAt);
    if (Number.isNaN(date.getTime())) {
      return '未完成云同步';
    }
    return date.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }, [cloudSyncLastAt, locale]);
  const syncIndicatorTone = useMemo(() => {
    if (!cloudSyncSession) {
      return 'idle';
    }
    if (isSyncingCloud) {
      return 'syncing';
    }
    if (cloudSyncError) {
      return 'error';
    }
    return 'success';
  }, [cloudSyncError, cloudSyncSession, isSyncingCloud]);
  const syncIndicatorLabel = useMemo(() => {
    if (!cloudSyncSession) {
      return '未连接云同步';
    }
    if (isSyncingCloud) {
      return '正在同步';
    }
    if (cloudSyncError) {
      return '同步失败';
    }
    return '同步已完成';
  }, [cloudSyncError, cloudSyncSession, isSyncingCloud]);
  const accountDisplayName = useMemo(() => {
    if (!cloudSyncSession?.email) {
      return '本地用户';
    }
    return cloudSyncSession.email;
  }, [cloudSyncSession]);
  const accountAvatarText = useMemo(() => {
    const source = cloudSyncSession?.email?.trim();
    if (!source) {
      return 'OT';
    }
    return source.slice(0, 2).toUpperCase();
  }, [cloudSyncSession]);

  const editingHost = useMemo(() => {
    if (!editingHostId) {
      return null;
    }
    return hosts.find((host) => buildHostKey(host) === editingHostId) ?? null;
  }, [editingHostId, hosts]);

  const editingIdentity = useMemo(() => {
    if (!editingHost) {
      return null;
    }
    return identities.find((identity) => identity.id === editingHost.identityId) ?? null;
  }, [editingHost, identities]);

  const editingLinkedHostCount = useMemo(() => {
    if (!editingIdentity) {
      return 0;
    }
    return hosts.filter((host) => host.identityId === editingIdentity.id).length;
  }, [editingIdentity, hosts]);

  const selectedTabHost = useMemo(() => {
    if (!selectedTabHostId) {
      return null;
    }
    return hosts.find((host) => buildHostKey(host) === selectedTabHostId) ?? null;
  }, [hosts, selectedTabHostId]);
  const activeWorkspace = useMemo(() => {
    if (!activeSessionId) {
      return null;
    }
    return splitWorkspaces[activeSessionId] ?? null;
  }, [activeSessionId, splitWorkspaces]);
  const activeTerminalSessionId = useMemo(() => {
    if (!activeSessionId) {
      return null;
    }
    const workspace = splitWorkspaces[activeSessionId];
    if (!workspace) {
      return activeSessionId;
    }
    const activePane = findPaneById(workspace.root, workspace.activePaneId);
    return activePane?.sessionId ?? activeSessionId;
  }, [activeSessionId, splitWorkspaces]);
  const activeTerminalHostId = useMemo(() => {
    if (!activeSessionId) {
      return null;
    }
    const workspace = splitWorkspaces[activeSessionId];
    if (workspace) {
      const activePane = findPaneById(workspace.root, workspace.activePaneId);
      if (activePane) {
        return activePane.hostId;
      }
    }
    return activeSessions.find((session) => session.id === activeSessionId)?.hostId ?? null;
  }, [activeSessionId, activeSessions, splitWorkspaces]);
  const activeTerminalTitle = useMemo(() => {
    if (!activeSessionId) {
      return null;
    }
    const workspace = splitWorkspaces[activeSessionId];
    if (workspace) {
      const activePane = findPaneById(workspace.root, workspace.activePaneId);
      if (activePane) {
        return activePane.title;
      }
    }
    return activeSessions.find((session) => session.id === activeSessionId)?.title ?? null;
  }, [activeSessionId, activeSessions, splitWorkspaces]);
  const activeSessionSysStatus = useMemo(() => {
    if (!activeTerminalSessionId) {
      return null;
    }
    return sysStatusBySession[activeTerminalSessionId] ?? null;
  }, [activeTerminalSessionId, sysStatusBySession]);
  const previousSessionCountRef = useRef<number>(activeSessions.length);
  const terminalSplitRef = useRef<HTMLElement | null>(null);
  const syncIndicatorRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const hostSearchInputRef = useRef<HTMLInputElement | null>(null);
  const splitWorkspacesRef = useRef<Record<string, TabSplitWorkspace>>(splitWorkspaces);
  const manualDetachedClosingRef = useRef<Set<string>>(new Set());
  const allowWindowCloseRef = useRef<boolean>(false);

  const tagStats = useMemo(() => {
    const map = new Map<string, number>();
    for (const host of hosts) {
      for (const rawTag of host.advancedOptions.tags) {
        const tag = rawTag.trim();
        if (!tag) {
          continue;
        }
        const prev = map.get(tag) ?? 0;
        map.set(tag, prev + 1);
      }
    }
    return Array.from(map.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag, 'zh-CN'));
  }, [hosts]);

  const filteredHosts = useMemo(() => {
    const query = hostSearchQuery.trim().toLowerCase();
    return hosts.filter((host) => {
      if (activeTagFilter !== 'all' && !host.advancedOptions.tags.includes(activeTagFilter)) {
        return false;
      }
      if (!query) {
        return true;
      }
      const searchable = [
        host.basicInfo.name,
        host.basicInfo.address,
        ...host.advancedOptions.tags
      ]
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [activeTagFilter, hostSearchQuery, hosts]);

  const openSettingsCategory = useCallback((category: SettingsCategory): void => {
    setSettingsCategory(category);
    setSettingsFocusSectionId(null);
    setSettingsFocusSequence((prev) => prev + 1);
    setIsSettingsOpen(true);
    setIsProfileMenuOpen(false);
  }, []);

  const openSettingsSection = useCallback((sectionId: string): void => {
    const category = SETTINGS_SECTION_CATEGORY_MAP[sectionId] ?? 'settings';
    setSettingsCategory(category);
    setSettingsFocusSectionId(sectionId);
    setSettingsFocusSequence((prev) => prev + 1);
    setIsSettingsOpen(true);
    setIsProfileMenuOpen(false);
  }, []);

  const commandPaletteRuntimeItems = useMemo<PaletteRuntimeItem[]>(() => {
    if (appView !== 'dashboard') {
      return [];
    }

    const query = commandPaletteQuery.trim().toLowerCase();
    const results: PaletteRuntimeItem[] = [];
    const now = Date.now();
    const identityById = new Map(identities.map((identity) => [identity.id, identity]));

    for (const host of hosts) {
      const hostId = buildHostKey(host);
      const identity = identityById.get(host.identityId);
      const textScore = scoreSearchFields(query, [
        host.basicInfo.name,
        host.basicInfo.address,
        String(host.basicInfo.port),
        host.basicInfo.description,
        identity?.name ?? '',
        identity?.username ?? '',
        ...host.advancedOptions.tags
      ]);
      if (query && textScore <= 0) {
        continue;
      }

      const usage = hostUsageStats[hostId];
      const usageCountBoost = usage ? Math.min(180, usage.count * 18) : 0;
      const recencyBoost = usage
        ? Math.max(
            0,
            220 - Math.floor((now - usage.lastConnectedAt) / (1000 * 60 * 30)) * 8
          )
        : 0;
      const noQueryBase = query ? 0 : 120;
      const score = textScore + usageCountBoost + recencyBoost + noQueryBase;
      const hostTitle = host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`;
      const hostSubtitle = `${identity?.username ?? 'unknown'}@${host.basicInfo.address}:${host.basicInfo.port}`;
      results.push({
        id: `host:${hostId}`,
        kind: 'host',
        title: hostTitle,
        subtitle: hostSubtitle,
        hint: usage ? `连接 ${usage.count} 次` : '一键连接',
        score,
        execute: async () => {
          const success = await openTerminal(host);
          if (success) {
            setDashboardSection('terminal');
            recordHostConnection(hostId);
            setTerminalError(null);
          }
        }
      });
    }

    for (const snippet of snippets) {
      const textScore = scoreSearchFields(query, [snippet.title, snippet.command, ...snippet.tags]);
      if (query && textScore <= 0) {
        continue;
      }
      results.push({
        id: `snippet:${snippet.id}`,
        kind: 'snippet',
        title: snippet.title,
        subtitle: snippet.command,
        hint: '一键执行',
        score: textScore + (query ? 0 : 74),
        execute: async () => {
          if (!activeTerminalSessionId) {
            setDashboardSection('terminal');
            toast.message('请先建立终端连接，再执行指令片段。');
            return;
          }
          try {
            await sshWrite(activeTerminalSessionId, `${snippet.command}\n`);
            setTerminalError(null);
          } catch (error) {
            const fallback = '写入终端失败，连接可能已断开。';
            const message = error instanceof Error ? error.message : fallback;
            setTerminalError(message || fallback);
            toast.error(message || fallback);
          }
        }
      });
    }

    for (const item of PALETTE_SETTINGS_ENTRIES) {
      const textScore = scoreSearchFields(query, [item.title, item.subtitle, ...item.keywords]);
      if (query && textScore <= 0) {
        continue;
      }
      results.push({
        id: `setting:${item.id}`,
        kind: 'setting',
        title: item.title,
        subtitle: item.subtitle,
        hint: '跳转',
        score: textScore + (query ? 0 : 54),
        execute: () => {
          openSettingsSection(item.sectionId);
        }
      });
    }

    const actionCandidates: ReadonlyArray<{
      id: string;
      title: string;
      subtitle: string;
      keywords: string[];
      execute: () => void;
    }> = [
      {
        id: 'action:new-host',
        title: '新增主机',
        subtitle: '打开三步向导创建主机',
        keywords: ['新增', '主机', '向导', 'add host'],
        execute: () => {
          reset();
          setIsHostWizardOpen(true);
          setDashboardSection('hosts');
        }
      },
      {
        id: 'action:new-tab',
        title: '新建终端标签',
        subtitle: '选择主机后创建新会话',
        keywords: ['新建', 'tab', '标签', '会话'],
        execute: () => {
          setIsNewTabModalOpen(true);
          setDashboardSection('terminal');
        }
      },
      {
        id: 'action:logs',
        title: '查看连接日志',
        subtitle: '打开 Inspector 查看 SSH 诊断日志',
        keywords: ['日志', '连接日志', 'inspector', 'ssh log'],
        execute: () => {
          setIsInspectorOpen(true);
        }
      },
      {
        id: 'action:ai',
        title: '打开灵思助手',
        subtitle: '呼出 AI 命令助手面板',
        keywords: ['ai', '助手', '灵思', '命令生成'],
        execute: () => {
          setIsAiAssistantOpen(true);
        }
      },
      {
        id: 'action:about',
        title: '关于 OrbitTerm',
        subtitle: '查看版本信息与下载提示',
        keywords: ['关于', '版本', 'release', '更新'],
        execute: () => {
          setIsAboutOpen(true);
        }
      },
      {
        id: 'action:lock',
        title: '立即锁定金库',
        subtitle: '快速回到解锁界面',
        keywords: ['锁定', '金库', '安全', 'lock'],
        execute: () => {
          void lockVault();
        }
      }
    ];

    for (const action of actionCandidates) {
      const textScore = scoreSearchFields(query, [action.title, action.subtitle, ...action.keywords]);
      if (query && textScore <= 0) {
        continue;
      }
      results.push({
        id: action.id,
        kind: 'action',
        title: action.title,
        subtitle: action.subtitle,
        hint: '执行',
        score: textScore + (query ? 0 : 38),
        execute: action.execute
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 40);
  }, [
    activeTerminalSessionId,
    appView,
    commandPaletteQuery,
    hostUsageStats,
    hosts,
    identities,
    lockVault,
    openSettingsSection,
    openTerminal,
    recordHostConnection,
    reset,
    setTerminalError,
    snippets
  ]);

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    return commandPaletteRuntimeItems.map(({ score: _score, execute: _execute, ...item }) => item);
  }, [commandPaletteRuntimeItems]);

  useEffect(() => {
    const prevHtmlOverflow = document.documentElement.style.overflow;
    const prevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    return () => {
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    document.body.style.background = activeThemePreset.bodyBackground;
  }, [activeThemePreset.bodyBackground]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--acrylic-blur', `${acrylicBlur}px`);
    root.style.setProperty('--acrylic-saturation', `${acrylicSaturation}%`);
    root.style.setProperty('--acrylic-brightness', `${acrylicBrightness}%`);
  }, [acrylicBlur, acrylicBrightness, acrylicSaturation]);

  const performHealthCheck = async (showOkToast: boolean): Promise<void> => {
    try {
      const report = await runHealthCheck();
      setHealthReport(report);
      const issues = report.items.filter((item) => item.status !== 'ok');
      if (issues.length > 0) {
        const firstIssue = issues[0];
        if (!firstIssue) {
          return;
        }
        toast.warning(`环境检测异常：${firstIssue.label}`, {
          description: firstIssue.suggestion ?? firstIssue.message
        });
      } else if (showOkToast) {
        toast.success('环境健康检查通过');
      }
    } catch (error) {
      const fallback = '环境健康检查失败，请检查系统权限或网络。';
      const message = error instanceof Error ? error.message : fallback;
      toast.warning(message || fallback);
    }
  };

  useEffect(() => {
    void performHealthCheck(false);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (appView !== 'dashboard') {
        return;
      }

      const hasModifier = event.metaKey || event.ctrlKey;
      if (!hasModifier) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'k') {
        event.preventDefault();
        if (event.shiftKey) {
          setIsAiAssistantOpen((prev) => !prev);
          return;
        }
        setIsCommandPaletteOpen((prev) => {
          const next = !prev;
          if (next) {
            setCommandPaletteQuery('');
            setCommandPaletteActiveIndex(0);
          }
          return next;
        });
        return;
      }

      if (isCommandPaletteOpen) {
        return;
      }

      if (key === 't') {
        event.preventDefault();
        setIsNewTabModalOpen(true);
      }

      if (key === 'w') {
        event.preventDefault();
        void closeTerminal();
      }

      if (key === ',') {
        event.preventDefault();
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
        } else {
          openSettingsCategory('settings');
        }
      }

      if (key === 'f') {
        event.preventDefault();
        setDashboardSection('hosts');
        window.setTimeout(() => {
          hostSearchInputRef.current?.focus();
          hostSearchInputRef.current?.select();
        }, 0);
      }
    };

    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [appView, closeTerminal, isCommandPaletteOpen, isSettingsOpen, openSettingsCategory]);

  useEffect(() => {
    if (activeTagFilter === 'all') {
      return;
    }
    const exists = tagStats.some((item) => item.tag === activeTagFilter);
    if (!exists) {
      setActiveTagFilter('all');
    }
  }, [activeTagFilter, tagStats]);

  useEffect(() => {
    if (filteredHosts.length === 0) {
      setHighlightedSearchIndex(-1);
      return;
    }
    setHighlightedSearchIndex((prev) => {
      if (prev < 0) {
        return 0;
      }
      if (prev >= filteredHosts.length) {
        return filteredHosts.length - 1;
      }
      return prev;
    });
  }, [filteredHosts]);

  useEffect(() => {
    splitWorkspacesRef.current = splitWorkspaces;
  }, [splitWorkspaces]);

  useEffect(() => {
    const activeSessionMap = new Map(activeSessions.map((session) => [session.id, session]));
    const detachedToClose: string[] = [];

    setSplitWorkspaces((prev) => {
      const next: Record<string, TabSplitWorkspace> = {};
      for (const session of activeSessions) {
        const existing = prev[session.id];
        if (!existing) {
          next[session.id] = createDefaultWorkspace(session);
          continue;
        }

        const updatedRoot = updatePaneBySessionId(existing.root, session.id, {
          hostId: session.hostId,
          title: session.title
        });
        const hasRootSession = Boolean(findPaneBySessionId(updatedRoot, session.id));
        const ensuredRoot = hasRootSession
          ? updatedRoot
          : {
              type: 'split' as const,
              id: createSplitId(),
              direction: 'horizontal' as const,
              sizes: [48, 52] as [number, number],
              first: createPaneNode({
                id: `pane-${session.id}`,
                sessionId: session.id,
                hostId: session.hostId,
                title: session.title
              }),
              second: updatedRoot
            };

        const panes = collectWorkspacePanes(ensuredRoot);
        const fallbackPaneId =
          panes.find((pane) => pane.sessionId === session.id)?.id ?? panes[0]?.id ?? `pane-${session.id}`;
        const activePaneExists = hasPaneId(ensuredRoot, existing.activePaneId);
        next[session.id] = {
          ...existing,
          root: ensuredRoot,
          activePaneId: activePaneExists ? existing.activePaneId : fallbackPaneId
        };
      }

      for (const [tabId, workspace] of Object.entries(prev)) {
        if (activeSessionMap.has(tabId)) {
          continue;
        }
        for (const pane of collectWorkspacePanes(workspace.root)) {
          if (pane.sessionId !== tabId) {
            detachedToClose.push(pane.sessionId);
          }
        }
      }
      return next;
    });

    for (const paneSessionId of detachedToClose) {
      void sshDisconnect(paneSessionId).catch(() => {
        // Ignore already-closed sessions while pruning workspace.
      });
    }
  }, [activeSessions]);

  useEffect(() => {
    if (!splitMenu) {
      return;
    }
    const closeMenu = (): void => {
      setSplitMenu(null);
    };
    window.addEventListener('click', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
    };
  }, [splitMenu]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<SshDiagnosticLogEvent>('ssh-diagnostic', (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      setSshDiagnosticLogs((prev) => {
        const next = [...prev, payload];
        if (next.length <= 2000) {
          return next;
        }
        return next.slice(next.length - 2000);
      });
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<SftpTransferProgressEvent>('sftp-transfer-progress', (event) => {
      if (disposed) {
        return;
      }
      applyTransferProgressEvent(event.payload);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [applyTransferProgressEvent]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void listen<SshSysStatusEvent>('ssh-sys-status', (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      setSysStatusBySession((prev) => ({
        ...prev,
        [payload.sessionId]: payload.status
      }));
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const activeIds = new Set<string>();
    for (const session of activeSessions) {
      activeIds.add(session.id);
      const workspace = splitWorkspaces[session.id];
      if (!workspace) {
        continue;
      }
      for (const pane of collectWorkspacePanes(workspace.root)) {
        activeIds.add(pane.sessionId);
      }
    }
    setSysStatusBySession((prev) => {
      const next: Record<string, SessionSysStatus> = {};
      for (const [sessionId, status] of Object.entries(prev)) {
        if (activeIds.has(sessionId)) {
          next[sessionId] = status;
        }
      }
      return next;
    });
  }, [activeSessions, splitWorkspaces]);

  useEffect(() => {
    if (activeSessions.length === 0) {
      return;
    }

    const allSessionIds = new Set<string>();
    for (const session of activeSessions) {
      allSessionIds.add(session.id);
      const workspace = splitWorkspaces[session.id];
      if (workspace) {
        for (const pane of collectWorkspacePanes(workspace.root)) {
          allSessionIds.add(pane.sessionId);
        }
      }
    }

    for (const sessionId of allSessionIds) {
      const isActive = sessionId === activeTerminalSessionId;
      void sshSetPulseActivity(sessionId, isActive).catch(() => {
        // Ignore pulse state sync errors to avoid blocking UI flow.
      });
    }
  }, [activeSessions, activeTerminalSessionId, splitWorkspaces]);

  useEffect(() => {
    if (!isSyncPopoverOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const root = syncIndicatorRef.current;
      if (!root) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!root.contains(target)) {
        setIsSyncPopoverOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isSyncPopoverOpen]);

  useEffect(() => {
    if (!isProfileMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      const root = profileMenuRef.current;
      if (!root) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!root.contains(target)) {
        setIsProfileMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
    };
  }, [isProfileMenuOpen]);

  useEffect(() => {
    if (isSettingsOpen) {
      setIsProfileMenuOpen(false);
    }
  }, [isSettingsOpen]);

  useEffect(() => {
    if (appView !== 'dashboard') {
      setIsCloudAuthModalOpen(false);
      setSkippedCloudAuthForCurrentUnlock(false);
      return;
    }
    if (cloudSyncSession) {
      setIsCloudAuthModalOpen(false);
      return;
    }
    if (!skippedCloudAuthForCurrentUnlock) {
      setIsCloudAuthModalOpen(true);
    }
  }, [appView, cloudSyncSession, skippedCloudAuthForCurrentUnlock]);

  useEffect(() => {
    if (appView !== 'dashboard' || !cloudSyncSession) {
      return;
    }

    const runAutoPull = (): void => {
      void syncPullFromCloud({ source: 'auto' });
    };

    const intervalId = window.setInterval(runAutoPull, AUTO_PULL_INTERVAL_MS);
    const onFocus = (): void => {
      runAutoPull();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        runAutoPull();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [appView, cloudSyncSession, syncPullFromCloud]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;

    void appWindow.onCloseRequested((event) => {
      if (allowWindowCloseRef.current) {
        return;
      }
      event.preventDefault();
      if (closeWindowAction === 'tray') {
        void appWindow.hide();
        return;
      }
      if (closeWindowAction === 'exit') {
        allowWindowCloseRef.current = true;
        void appWindow.close();
        return;
      }
      setIsCloseWindowPromptOpen(true);
      setRememberCloseActionChoice(false);
    }).then((fn) => {
      if (disposed) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [closeWindowAction]);

  const detectDownloadableRelease = useCallback(async (): Promise<void> => {
    const checkedAt = new Date().toISOString();
    try {
      const version = await getAppVersion();
      const result = await checkReleaseAvailability(version);
      const nextNotice: ReleaseNoticeState = result.hasUpdate
        ? {
            hasUpdate: true,
            latestVersion: result.latestVersion ?? null,
            releaseUrl: result.releaseUrl ?? null,
            checkedAt
          }
        : {
            hasUpdate: false,
            latestVersion: null,
            releaseUrl: result.releaseUrl ?? null,
            checkedAt
          };

      writeReleaseNoticeState(nextNotice);
      setReleaseNotice(nextNotice);
    } catch (_error) {
      const previous = readReleaseNoticeState();
      if (previous.checkedAt) {
        return;
      }
      const fallback: ReleaseNoticeState = {
        hasUpdate: previous.hasUpdate,
        latestVersion: previous.latestVersion,
        releaseUrl: previous.releaseUrl,
        checkedAt
      };
      writeReleaseNoticeState(fallback);
      setReleaseNotice(fallback);
    }
  }, []);

  useEffect(() => {
    if (!isNewTabModalOpen) {
      return;
    }
    if (hosts.length === 0) {
      setSelectedTabHostId('');
      return;
    }

    if (selectedTabHostId && hosts.some((host) => buildHostKey(host) === selectedTabHostId)) {
      return;
    }

    const firstHost = hosts[0];
    setSelectedTabHostId(firstHost ? buildHostKey(firstHost) : '');
  }, [hosts, isNewTabModalOpen, selectedTabHostId]);

  useEffect(() => {
    const previous = previousSessionCountRef.current;
    if (previous <= 1 && activeSessions.length > 1) {
      setIsSftpCollapsed(true);
      toast.info('已进入多会话模式，SFTP 面板已自动收起。');
    } else if (activeSessions.length <= 1) {
      setIsSftpCollapsed(false);
    }
    previousSessionCountRef.current = activeSessions.length;
  }, [activeSessions.length]);

  useEffect(() => {
    if (!isResizingSplit) {
      return;
    }

    const onPointerMove = (event: PointerEvent): void => {
      const container = terminalSplitRef.current;
      if (!container) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const available = rect.right - event.clientX;
      const maxWidth = Math.min(SFTP_PANEL_MAX_WIDTH, Math.max(SFTP_PANEL_MIN_WIDTH, rect.width - 320));
      const nextWidth = Math.min(maxWidth, Math.max(SFTP_PANEL_MIN_WIDTH, available));
      setSftpPanelWidth(Math.round(nextWidth));
    };

    const onPointerUp = (): void => {
      setIsResizingSplit(false);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isResizingSplit]);

  useEffect(() => {
    if (appView !== 'dashboard' || !autoLockEnabled) {
      return;
    }

    const lockAfterMs = autoLockMinutes * 60 * 1000;
    let hiddenTimer: number | null = null;
    let didLock = false;
    let lastActivityAt = Date.now();

    const triggerAutoLock = (description: string): void => {
      if (didLock) {
        return;
      }
      didLock = true;
      void lockVault().then(() => {
        toast.warning('金库已自动锁定', {
          description
        });
        const dayLabel = buildLocalDayLabel(new Date());
        if (wasDailyLockChecked(dayLabel)) {
          return;
        }
        void detectDownloadableRelease().finally(() => {
          rememberDailyLockCheck(dayLabel);
        });
      });
    };

    const markActivity = (): void => {
      lastActivityAt = Date.now();
    };

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') {
        if (hiddenTimer !== null) {
          window.clearTimeout(hiddenTimer);
        }
        hiddenTimer = window.setTimeout(() => {
          triggerAutoLock(`应用已隐藏超过 ${autoLockMinutes} 分钟。`);
        }, lockAfterMs);
      } else {
        if (hiddenTimer !== null) {
          window.clearTimeout(hiddenTimer);
          hiddenTimer = null;
        }
        markActivity();
      }
    };

    const idleCheckTimer = window.setInterval(() => {
      if (Date.now() - lastActivityAt >= lockAfterMs) {
        triggerAutoLock(`检测到闲置超过 ${autoLockMinutes} 分钟。`);
      }
    }, 15000);

    const activityEvents: ReadonlyArray<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'focus'
    ];

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      if (hiddenTimer !== null) {
        window.clearTimeout(hiddenTimer);
      }
      window.clearInterval(idleCheckTimer);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markActivity);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [appView, autoLockEnabled, autoLockMinutes, detectDownloadableRelease, lockVault]);

  useEffect(() => {
    if (appView !== 'dashboard' || autoLockEnabled) {
      return;
    }

    let lastActivityAt = Date.now();
    let hasCheckedInCurrentIdleCycle = false;

    const markActivity = (): void => {
      lastActivityAt = Date.now();
      hasCheckedInCurrentIdleCycle = false;
    };

    const timerId = window.setInterval(() => {
      const idleMs = Date.now() - lastActivityAt;
      if (idleMs < IDLE_RELEASE_CHECK_MS || hasCheckedInCurrentIdleCycle) {
        return;
      }
      hasCheckedInCurrentIdleCycle = true;
      void detectDownloadableRelease();
    }, 15000);

    const activityEvents: ReadonlyArray<keyof WindowEventMap> = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'focus'
    ];

    for (const eventName of activityEvents) {
      window.addEventListener(eventName, markActivity, { passive: true });
    }

    return () => {
      window.clearInterval(timerId);
      for (const eventName of activityEvents) {
        window.removeEventListener(eventName, markActivity);
      }
    };
  }, [appView, autoLockEnabled, detectDownloadableRelease]);

  const sendCommandToTerminal = async (command: string, execute = false): Promise<void> => {
    if (!command.trim()) {
      return;
    }
    if (!activeTerminalSessionId) {
      throw new Error('请先建立一个终端会话。');
    }

    try {
      const payload = execute ? `${command}\n` : command;
      await sshWrite(activeTerminalSessionId, payload);
      setTerminalError(null);
    } catch (error) {
      const fallback = '写入终端失败，连接可能已断开。';
      const message = error instanceof Error ? error.message : fallback;
      setTerminalError(message || fallback);
      throw new Error(message || fallback);
    }
  };

  const fillCommandIntoTerminal = async (command: string): Promise<void> => {
    await sendCommandToTerminal(command, false);
  };

  const runSnippetInTerminal = async (command: string, autoEnter: boolean): Promise<void> => {
    await sendCommandToTerminal(command, autoEnter);
  };

  const handleSyncPathToSftp = async (): Promise<void> => {
    if (!activeTerminalSessionId) {
      toast.error('请先建立终端会话，再执行路径同步。');
      return;
    }
    if (isSyncingPath) {
      return;
    }

    setIsSyncingPath(true);
    try {
      const currentPath = await sshQueryPwd(activeTerminalSessionId);
      setSftpSyncRequest({
        sessionId: activeTerminalSessionId,
        path: currentPath,
        nonce: Date.now()
      });
      toast.success(`已同步到路径：${currentPath}`);
    } catch (error) {
      const fallback = '路径同步失败，请确认终端仍在线。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    } finally {
      setIsSyncingPath(false);
    }
  };

  const tryAutoReconnect = async (closedSession: { hostId: string; title: string }): Promise<void> => {
    const targetHost = hosts.find((host) => buildHostKey(host) === closedSession.hostId);
    if (!targetHost) {
      toast.error('自动重连失败：未找到原始主机配置。');
      return;
    }

    const maxAttempts = 4;
    const baseDelayMs = 1000;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      setReconnectMessage(`正在尝试自动重连...（第 ${attempt}/${maxAttempts} 次）`);
      const success = await openTerminal(targetHost);
      if (success) {
        setReconnectMessage(null);
        toast.success(`已自动重连：${closedSession.title}`);
        return;
      }

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * 2 ** (attempt - 1);
        await new Promise((resolve) => window.setTimeout(resolve, delay));
      }
    }

    setReconnectMessage(null);
    toast.error(`自动重连失败：${closedSession.title}`);
  };

  const handleAskAiForSshFix = async (errorMessage: string, logContext: string[]) => {
    return aiExplainSshError(errorMessage, logContext);
  };

  const handleDeleteHost = async (hostId: string, hostName: string): Promise<void> => {
    const shouldDelete = window.confirm(`确认删除主机「${hostName}」吗？该操作会同步更新本地金库。`);
    if (!shouldDelete) {
      return;
    }

    try {
      await deleteHost(hostId);
    } catch (error) {
      const fallback = '删除主机失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleSaveHostEdit = async (values: HostEditFormValues): Promise<void> => {
    if (!editingHostId) {
      return;
    }

    try {
      await updateHostAndIdentity(editingHostId, {
        basicInfo: {
          name: values.name,
          address: values.address,
          port: values.port,
          description: values.description,
          tagsText: values.tagsText
        },
        identity: {
          name: values.identityName,
          username: values.identityUsername,
          authConfig:
            values.method === 'password'
              ? {
                  method: 'password',
                  password: values.password?.trim() ?? '',
                  privateKey: '',
                  passphrase: ''
                }
              : {
                  method: 'privateKey',
                  password: '',
                  privateKey: values.privateKey?.trim() ?? '',
                  passphrase: values.passphrase ?? ''
                }
        }
      });
      setEditingHostId(null);
    } catch (error) {
      const fallback = '保存主机编辑失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    }
  };

  const handleOpenHostWizard = (): void => {
    reset();
    setIsHostWizardOpen(true);
  };

  const handleCloseHostWizard = (): void => {
    setIsHostWizardOpen(false);
  };

  const handleConnectFromHostList = async (hostId: string): Promise<void> => {
    const target = hosts.find((host) => buildHostKey(host) === hostId);
    if (!target) {
      toast.error('未找到目标主机，请刷新后重试。');
      return;
    }

    const success = await openTerminal(target);
    if (success) {
      setDashboardSection('terminal');
      recordHostConnection(hostId);
      setTerminalError(null);
    }
  };

  const handleHostSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (filteredHosts.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedSearchIndex((prev) => {
        const next = prev < 0 ? 0 : prev + 1;
        return next >= filteredHosts.length ? 0 : next;
      });
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedSearchIndex((prev) => {
        if (prev <= 0) {
          return filteredHosts.length - 1;
        }
        return prev - 1;
      });
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const index = highlightedSearchIndex < 0 ? 0 : highlightedSearchIndex;
      const target = filteredHosts[index];
      if (!target) {
        return;
      }
      const hostId = buildHostKey(target);
      void handleConnectFromHostList(hostId);
    }
  };

  const handleConnectFromNewTabModal = async (): Promise<void> => {
    if (!selectedTabHost) {
      toast.error('请选择一台主机后再新建标签。');
      return;
    }

    const success = await openTerminal(selectedTabHost);
    if (success) {
      setDashboardSection('terminal');
      recordHostConnection(buildHostKey(selectedTabHost));
      setTerminalError(null);
      setIsNewTabModalOpen(false);
    }
  };

  const handleManualPullSync = async (): Promise<void> => {
    if (!cloudSyncSession) {
      toast.message('请先登录私有云同步账号。');
      setIsCloudAuthModalOpen(true);
      return;
    }

    await syncPullFromCloud({ source: 'manual', force: true });
    const latestError = useHostStore.getState().cloudSyncError;
    if (latestError) {
      toast.error(latestError);
      return;
    }
    toast.success('已完成云端拉取检查');
  };

  const handleManualForcePushSync = async (): Promise<void> => {
    if (!cloudSyncSession) {
      toast.message('请先登录私有云同步账号。');
      setIsCloudAuthModalOpen(true);
      return;
    }

    await syncPushToCloud({ source: 'manual', force: true });
    const latestError = useHostStore.getState().cloudSyncError;
    if (latestError) {
      toast.error(latestError);
      return;
    }
    toast.success('已触发强制推送');
  };

  const setActivePane = useCallback((tabSessionId: string, paneId: string): void => {
    setSplitWorkspaces((prev) => {
      const workspace = prev[tabSessionId];
      if (!workspace) {
        return prev;
      }
      if (!hasPaneId(workspace.root, paneId)) {
        return prev;
      }
      if (workspace.activePaneId === paneId) {
        return prev;
      }
      return {
        ...prev,
        [tabSessionId]: {
          ...workspace,
          activePaneId: paneId
        }
      };
    });
  }, []);

  const handleToggleSyncInput = useCallback((): void => {
    if (!activeSessionId) {
      return;
    }
    setSplitWorkspaces((prev) => {
      const workspace = prev[activeSessionId];
      if (!workspace) {
        return prev;
      }
      return {
        ...prev,
        [activeSessionId]: {
          ...workspace,
          syncInput: !workspace.syncInput
        }
      };
    });
  }, [activeSessionId]);

  const handlePaneInput = useCallback(
    (tabSessionId: string, sourceSessionId: string, data: string): void => {
      if (!data) {
        return;
      }

      const workspace = splitWorkspacesRef.current[tabSessionId];
      const targets = workspace && workspace.syncInput
        ? Array.from(
            new Set(collectWorkspacePanes(workspace.root).map((pane) => pane.sessionId))
          )
        : [sourceSessionId];

      let hasError = false;
      for (const targetSessionId of targets) {
        void sshWrite(targetSessionId, data).catch(() => {
          if (hasError) {
            return;
          }
          hasError = true;
          setTerminalError('发送输入失败，连接可能已断开。');
        });
      }
    },
    [setTerminalError]
  );

  const handlePaneSessionClosed = useCallback(
    (tabSessionId: string, paneId: string, sessionId: string): void => {
      const workspace = splitWorkspacesRef.current[tabSessionId];
      const pane =
        workspace ? findPaneById(workspace.root, paneId) ?? findPaneBySessionId(workspace.root, sessionId) : null;
      if (!pane) {
        return;
      }

      if (pane.sessionId === tabSessionId) {
        const closeReason = handleSessionClosed(tabSessionId);
        if (closeReason === 'manual') {
          return;
        }
        toast.warning(`SSH 会话中断：${pane.title}`);
        void tryAutoReconnect({
          hostId: pane.hostId,
          title: pane.title
        });
        return;
      }

      const wasManual = manualDetachedClosingRef.current.delete(pane.sessionId);
      setSplitWorkspaces((prev) => {
        const workspace = prev[tabSessionId];
        if (!workspace) {
          return prev;
        }
        const removeResult = removePaneFromLayout(workspace.root, pane.id);
        if (!removeResult.removedPane || !removeResult.nextNode) {
          return prev;
        }
        const remainingPanes = collectWorkspacePanes(removeResult.nextNode);
        const fallbackPaneId = remainingPanes[0]?.id ?? `pane-${tabSessionId}`;
        const nextActivePaneId =
          workspace.activePaneId === pane.id || !hasPaneId(removeResult.nextNode, workspace.activePaneId)
            ? fallbackPaneId
            : workspace.activePaneId;
        return {
          ...prev,
          [tabSessionId]: {
            ...workspace,
            root: removeResult.nextNode,
            activePaneId: nextActivePaneId
          }
        };
      });

      if (!wasManual) {
        toast.warning(`分屏会话中断：${pane.title}`);
      }
    },
    [handleSessionClosed]
  );

  const handleClosePane = useCallback(async (tabSessionId: string, paneId: string): Promise<void> => {
    const workspace = splitWorkspacesRef.current[tabSessionId];
    const pane = workspace ? findPaneById(workspace.root, paneId) : null;
    if (!workspace || !pane) {
      return;
    }

    if (pane.sessionId === tabSessionId) {
      toast.message('主会话请通过“关闭当前”按钮关闭。');
      return;
    }

    manualDetachedClosingRef.current.add(pane.sessionId);
    setSplitWorkspaces((prev) => {
      const target = prev[tabSessionId];
      if (!target) {
        return prev;
      }
      const removeResult = removePaneFromLayout(target.root, paneId);
      if (!removeResult.removedPane || !removeResult.nextNode) {
        return prev;
      }
      const remainingPanes = collectWorkspacePanes(removeResult.nextNode);
      const fallbackPaneId = remainingPanes[0]?.id ?? `pane-${tabSessionId}`;
      const nextActivePaneId =
        target.activePaneId === paneId || !hasPaneId(removeResult.nextNode, target.activePaneId)
          ? fallbackPaneId
          : target.activePaneId;
      return {
        ...prev,
        [tabSessionId]: {
          ...target,
          root: removeResult.nextNode,
          activePaneId: nextActivePaneId
        }
      };
    });

    try {
      await sshDisconnect(pane.sessionId);
    } catch (_error) {
      toast.warning('分屏会话关闭时出现异常，已在本地移除该分屏。');
    } finally {
      window.setTimeout(() => {
        manualDetachedClosingRef.current.delete(pane.sessionId);
      }, 1200);
    }
  }, []);

  const handleSplitFromMenu = useCallback(
    async (direction: SplitDirection): Promise<void> => {
      if (!splitMenu) {
        return;
      }

      const { tabSessionId, paneId } = splitMenu;
      setSplitMenu(null);

      const workspace = splitWorkspacesRef.current[tabSessionId];
      const sourcePane = workspace ? findPaneById(workspace.root, paneId) : null;
      if (!workspace || !sourcePane) {
        toast.error('分屏目标不存在，请重试。');
        return;
      }

      try {
        const detachedSession = await openDetachedSession(sourcePane.hostId);
        const nextPane: TerminalSplitPane = {
          id: createPaneId(tabSessionId),
          sessionId: detachedSession.id,
          hostId: sourcePane.hostId,
          title: detachedSession.title
        };
        setSplitWorkspaces((prev) => {
          const target = prev[tabSessionId];
          if (!target || !hasPaneId(target.root, paneId)) {
            return prev;
          }
          const nextRoot = replacePaneWithSplit(target.root, paneId, direction, nextPane);
          return {
            ...prev,
            [tabSessionId]: {
              ...target,
              root: nextRoot,
              activePaneId: nextPane.id
            }
          };
        });
        setActiveSession(tabSessionId);
      } catch (error) {
        const fallback = '创建分屏失败，请检查网络与认证状态。';
        const message = error instanceof Error ? error.message : fallback;
        toast.error(message || fallback);
      }
    },
    [openDetachedSession, setActiveSession, splitMenu]
  );

  const handlePaneContextMenu = (
    event: ReactMouseEvent<HTMLElement>,
    tabSessionId: string,
    paneId: string
  ): void => {
    event.preventDefault();
    setActiveSession(tabSessionId);
    setActivePane(tabSessionId, paneId);
    setSplitMenu({
      x: event.clientX,
      y: event.clientY,
      tabSessionId,
      paneId
    });
  };

  const splitMenuTargetPane = useMemo(() => {
    if (!splitMenu) {
      return null;
    }
    const workspace = splitWorkspaces[splitMenu.tabSessionId];
    if (!workspace) {
      return null;
    }
    return findPaneById(workspace.root, splitMenu.paneId);
  }, [splitMenu, splitWorkspaces]);

  const splitMenuCanCloseCurrent = useMemo(() => {
    if (!splitMenu || !splitMenuTargetPane) {
      return false;
    }
    if (splitMenuTargetPane.sessionId === splitMenu.tabSessionId) {
      return false;
    }
    const workspace = splitWorkspaces[splitMenu.tabSessionId];
    if (!workspace) {
      return false;
    }
    return collectWorkspacePanes(workspace.root).length > 1;
  }, [splitMenu, splitMenuTargetPane, splitWorkspaces]);

  const handleCommandPaletteClose = (): void => {
    setIsCommandPaletteOpen(false);
    setCommandPaletteQuery('');
    setCommandPaletteActiveIndex(0);
  };

  const handleCommandPaletteConfirm = (item: CommandPaletteItem): void => {
    const runtimeItem = commandPaletteRuntimeItems.find((entry) => entry.id === item.id);
    if (!runtimeItem) {
      return;
    }
    handleCommandPaletteClose();
    void Promise.resolve(runtimeItem.execute()).catch((error) => {
      const fallback = '命令面板执行失败，请稍后重试。';
      const message = error instanceof Error ? error.message : fallback;
      toast.error(message || fallback);
    });
  };

  if (!hasCompletedOnboarding) {
    return (
      <>
        <FirstRunOnboarding />
        <Toaster closeButton expand position="top-right" richColors />
      </>
    );
  }

  if (appView === 'locked') {
    return (
      <>
        <UnlockScreen />
        <Toaster closeButton expand position="top-right" richColors />
      </>
    );
  }

  return (
    <main className="h-screen w-screen overflow-hidden p-3 sm:p-4">
      <section className="glass-card flex h-full w-full flex-col overflow-hidden rounded-3xl border border-frost-border bg-frost-panel shadow-glass">
        <header className="shrink-0 border-b border-white/55 px-5 py-4 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">OrbitTerm · 轨连终端</p>
              <h1 className="mt-1 text-2xl font-semibold text-slate-900">Dashboard · 主机金库</h1>
              <p className="mt-1 text-sm text-slate-600">金库已解锁，可管理主机资产并建立多标签会话。</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="group relative" ref={syncIndicatorRef}>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/90 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-white"
                  onClick={() => {
                    setIsSyncPopoverOpen((prev) => !prev);
                    setIsProfileMenuOpen(false);
                  }}
                  title={`上次同步：${syncLastText}`}
                  type="button"
                >
                  <span
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] ${
                      syncIndicatorTone === 'success'
                        ? 'border-emerald-300 bg-emerald-100 text-emerald-700'
                        : syncIndicatorTone === 'syncing'
                          ? 'animate-spin border-amber-300 bg-amber-100 text-amber-700'
                          : syncIndicatorTone === 'error'
                            ? 'border-rose-300 bg-rose-100 text-rose-700'
                            : 'border-slate-300 bg-slate-100 text-slate-600'
                    }`}
                  >
                    ☁
                  </span>
                  <span
                    className={`h-2 w-2 rounded-full ${
                      syncIndicatorTone === 'success'
                        ? 'bg-emerald-500'
                        : syncIndicatorTone === 'syncing'
                          ? 'bg-amber-500'
                          : syncIndicatorTone === 'error'
                            ? 'bg-rose-500'
                            : 'bg-slate-400'
                    }`}
                  />
                  <span className="hidden sm:inline">{syncIndicatorLabel}</span>
                </button>
                <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-20 min-w-[220px] rounded-md border border-slate-200 bg-slate-900/95 px-2.5 py-1.5 text-[11px] text-slate-100 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100">
                  上次同步：{syncLastText}
                </div>
                {isSyncPopoverOpen && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-56 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur">
                    <p className="px-1 text-[11px] text-slate-500">上次同步：{syncLastText}</p>
                    <div className="mt-2 grid gap-1.5">
                      <button
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSyncingCloud || !cloudSyncSession}
                        onClick={() => {
                          void handleManualPullSync().finally(() => {
                            setIsSyncPopoverOpen(false);
                          });
                        }}
                        type="button"
                      >
                        立即拉取
                      </button>
                      <button
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isSyncingCloud || !cloudSyncSession}
                        onClick={() => {
                          void handleManualForcePushSync().finally(() => {
                            setIsSyncPopoverOpen(false);
                          });
                        }}
                        type="button"
                      >
                        强制推送
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="relative" ref={profileMenuRef}>
                <button
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white/90 px-2 py-1.5 text-xs text-slate-700 hover:bg-white"
                  onClick={() => {
                    setIsProfileMenuOpen((prev) => !prev);
                    setIsSyncPopoverOpen(false);
                  }}
                  type="button"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#8fb1df] bg-[#285793] text-[11px] font-semibold text-white">
                    {accountAvatarText}
                  </span>
                  <span className="hidden max-w-[140px] truncate sm:inline">{accountDisplayName}</span>
                </button>

                {isProfileMenuOpen && (
                  <div className="absolute right-0 top-[calc(100%+8px)] z-30 w-72 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-xl backdrop-blur">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                      <p className="truncate text-xs font-semibold text-slate-800">{accountDisplayName}</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {cloudSyncSession ? '私有云已连接' : '私有云未连接'}
                      </p>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <p className="px-1 text-[11px] font-semibold text-slate-500">个人信息</p>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          if (cloudSyncSession) {
                            openSettingsSection('settings-sync');
                            return;
                          }
                          setIsCloudAuthModalOpen(true);
                          setIsProfileMenuOpen(false);
                        }}
                        type="button"
                      >
                        账号与同步
                      </button>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          openSettingsSection('settings-devices');
                        }}
                        type="button"
                      >
                        登录设备管理
                      </button>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <p className="px-1 text-[11px] font-semibold text-slate-500">设置</p>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          openSettingsSection('settings-font');
                        }}
                        type="button"
                      >
                        字体与外观
                      </button>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          openSettingsSection('settings-theme');
                        }}
                        type="button"
                      >
                        主题与安全
                      </button>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <p className="px-1 text-[11px] font-semibold text-slate-500">文件</p>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          openSettingsSection('settings-identity');
                        }}
                        type="button"
                      >
                        身份与 SSH 密钥
                      </button>
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <p className="px-1 text-[11px] font-semibold text-slate-500">其他</p>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          openSettingsSection('settings-about');
                        }}
                        type="button"
                      >
                        关于 OrbitTerm
                      </button>
                      <button
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          openSettingsCategory('settings');
                        }}
                        type="button"
                      >
                        打开设置中心 (Cmd/Ctrl+,)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className={`${toolbarButtonClass} ${dashboardSection === 'hosts' ? 'border-[#bfd3ef] bg-[#e8f1ff] text-[#1f4e8f]' : ''}`}
              onClick={() => setDashboardSection('hosts')}
              type="button"
            >
              资产管理
            </button>
            <button
              className={`${toolbarButtonClass} ${dashboardSection === 'terminal' ? 'border-[#bfd3ef] bg-[#e8f1ff] text-[#1f4e8f]' : ''}`}
              onClick={() => setDashboardSection('terminal')}
              type="button"
            >
              终端会话
            </button>
            <button
              className={toolbarButtonClass}
              onClick={handleOpenHostWizard}
              type="button"
            >
              新增主机
            </button>
            <button
              className="rounded-lg border border-[#8eadde] bg-[#e9f1ff] px-3 py-1.5 text-xs font-medium text-[#204e8f] hover:bg-[#dbe9ff]"
              onClick={() => {
                setIsNewTabModalOpen(true);
              }}
              type="button"
            >
              新建标签 (Cmd/Ctrl+T)
            </button>
            <button
              className={toolbarButtonClass}
              onClick={() => setIsInspectorOpen(true)}
              type="button"
            >
              连接日志
            </button>
            <button
              className="ml-auto rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
              onClick={() => {
                void lockVault();
              }}
              type="button"
            >
              立即锁定
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden px-5 py-4 sm:px-6 sm:py-5">
          {saveError && (
            <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50/80 px-4 py-3 text-sm text-rose-700">
              {saveError}
            </p>
          )}

          {dashboardSection === 'hosts' && (
            <section className="flex h-full min-h-0 gap-3 rounded-2xl border border-white/65 bg-white/50 p-4">
              <aside className="w-40 shrink-0 rounded-xl border border-white/70 bg-white/65 p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">标签分类</p>
                <div className="mt-3 space-y-1.5">
                  <button
                    className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-xs ${
                      activeTagFilter === 'all'
                        ? 'border-[#90b6ec] bg-[#e8f1ff] text-[#1f4e8f]'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    onClick={() => {
                      setActiveTagFilter('all');
                      setHighlightedSearchIndex(0);
                    }}
                    type="button"
                  >
                    <span>全部</span>
                    <span>{hosts.length}</span>
                  </button>
                  {tagStats.map((item) => (
                    <button
                      className={`flex w-full items-center justify-between rounded-lg border px-2 py-1.5 text-xs ${
                        activeTagFilter === item.tag
                          ? 'border-[#90b6ec] bg-[#e8f1ff] text-[#1f4e8f]'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                      key={item.tag}
                      onClick={() => {
                        setActiveTagFilter(item.tag);
                        setHighlightedSearchIndex(0);
                      }}
                      type="button"
                    >
                      <span className="truncate">{item.tag}</span>
                      <span>{item.count}</span>
                    </button>
                  ))}
                </div>
              </aside>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-slate-800">主机资产列表</h2>
                  <button
                    className={toolbarButtonClass}
                    onClick={handleOpenHostWizard}
                    type="button"
                  >
                    添加主机
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input
                    className="min-w-[240px] flex-1 rounded-xl border border-slate-300 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-[#90b6ec] focus:ring-2 focus:ring-[#90b6ec]/25"
                    onChange={(event) => {
                      setHostSearchQuery(event.target.value);
                      setHighlightedSearchIndex(0);
                    }}
                    onKeyDown={handleHostSearchKeyDown}
                    placeholder="搜索别名、IP 或标签（Cmd/Ctrl+F 聚焦）"
                    ref={hostSearchInputRef}
                    value={hostSearchQuery}
                  />
                  <span className="rounded-lg border border-slate-200 bg-white/80 px-2.5 py-1 text-xs text-slate-600">
                    结果 {filteredHosts.length} / {hosts.length}
                  </span>
                </div>

                <div className="mt-3 min-h-0 h-[calc(100%-84px)] space-y-3 overflow-auto pr-1">
                  {hosts.length === 0 && (
                    <p className="rounded-xl border border-dashed border-white/70 bg-white/65 px-4 py-3 text-sm text-slate-600">
                      当前金库中暂无主机，请点击顶部“新增主机”开始配置。
                    </p>
                  )}

                  {hosts.length > 0 && filteredHosts.length === 0 && (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-3 text-sm text-slate-600">
                      未匹配到主机，请调整搜索关键词或标签筛选。
                    </p>
                  )}

                  {filteredHosts.map((host, index) => {
                    const hostId = buildHostKey(host);
                    const identity = identities.find((item) => item.id === host.identityId);
                    const isHighlighted = index === highlightedSearchIndex;
                    return (
                      <article
                        className={`rounded-xl border bg-white/75 px-4 py-3 ${
                          isHighlighted ? 'border-[#90b6ec] shadow-[0_0_0_2px_rgba(144,182,236,0.25)]' : 'border-white/70'
                        }`}
                        key={`${host.basicInfo.address}-${host.identityId}-${index}`}
                        onMouseEnter={() => setHighlightedSearchIndex(index)}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-[220px] flex-1">
                            <p className="text-sm font-semibold text-slate-800">
                              {host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">
                              {(identity?.username ?? 'unknown')}@{host.basicInfo.address}:{host.basicInfo.port}
                            </p>
                            <p className="mt-1 text-[11px] text-slate-500">身份：{identity?.name ?? '未绑定身份'}</p>
                            {host.basicInfo.description.trim() && (
                              <p className="mt-1 text-[11px] text-slate-500">备注：{host.basicInfo.description}</p>
                            )}
                            {host.advancedOptions.tags.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {host.advancedOptions.tags.map((tag) => (
                                  <button
                                    className="rounded-md border border-[#bdd2f1] bg-[#edf4ff] px-2 py-0.5 text-[11px] text-[#275191] hover:bg-[#dfeeff]"
                                    key={`${hostId}-${tag}`}
                                    onClick={() => {
                                      setActiveTagFilter(tag);
                                      setHighlightedSearchIndex(0);
                                    }}
                                    type="button"
                                  >
                                    {tag}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              className={toolbarButtonClass}
                              onClick={() => {
                                setEditingHostId(hostId);
                              }}
                              type="button"
                            >
                              编辑
                            </button>
                            <button
                              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
                              onClick={() => {
                                void handleDeleteHost(
                                  hostId,
                                  host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`
                                );
                              }}
                              type="button"
                            >
                              删除
                            </button>
                            <button
                              className="rounded-lg border border-[#4f78af] bg-[#0a3a78] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0d4b98] disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={isConnectingTerminal}
                              onClick={() => {
                                void handleConnectFromHostList(hostId);
                              }}
                              type="button"
                            >
                              {isConnectingTerminal ? '连接中...' : '连接'}
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {dashboardSection === 'terminal' && (
            <section
              className="relative flex h-full min-h-0 gap-3 overflow-hidden rounded-2xl border border-[#1f314e] bg-[#04060a] p-3"
              ref={terminalSplitRef}
            >
              <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[#1a2c47] bg-[#050a12] p-3">
                <SnippetsPanel
                  hasActiveSession={Boolean(activeTerminalSessionId)}
                  onCreateSnippet={addSnippet}
                  onDeleteSnippet={deleteSnippet}
                  onRunSnippet={runSnippetInTerminal}
                  onUpdateSnippet={updateSnippet}
                  snippets={snippets}
                />
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[#d7e5ff]">轨连终端</h2>
                  <div className="flex items-center gap-2">
                    <button
                      className={darkPanelButtonClass}
                      onClick={() => {
                        setIsNewTabModalOpen(true);
                      }}
                      type="button"
                    >
                      新建标签
                    </button>
                    <button
                      className={darkPanelButtonClass}
                      onClick={() => {
                        setIsInspectorOpen(true);
                      }}
                      type="button"
                    >
                      查看连接日志
                    </button>
                    {activeTerminalSessionId && (
                      <button
                        className={`${darkPanelButtonClass} disabled:cursor-not-allowed disabled:opacity-55`}
                        disabled={isSyncingPath}
                        onClick={() => {
                          void handleSyncPathToSftp();
                        }}
                        type="button"
                      >
                        {isSyncingPath ? '同步中...' : '同步路径'}
                      </button>
                    )}
                    {activeSessionId && (
                      <button
                        className={`${darkPanelButtonClass} ${
                          activeWorkspace?.syncInput
                            ? 'border-[#5cc89a] bg-[#123826] text-[#c9f4de] hover:bg-[#174932]'
                            : ''
                        }`}
                        onClick={handleToggleSyncInput}
                        title="开启后，当前标签下所有分屏将同步输入"
                        type="button"
                      >
                        {activeWorkspace?.syncInput ? '同步输入：开' : '同步输入：关'}
                      </button>
                    )}
                    {activeSessionId && (
                      <button
                        className={darkPanelButtonClass}
                        onClick={() => {
                          void closeTerminal();
                        }}
                        type="button"
                      >
                        关闭当前 (Cmd/Ctrl+W)
                      </button>
                    )}
                    {activeSessions.length > 1 && (
                      <button
                        className="rounded-lg border border-amber-500 bg-amber-200/90 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
                        onClick={() => {
                          setIsSftpCollapsed((prev) => !prev);
                        }}
                        type="button"
                      >
                        {isSftpCollapsed ? '展开 SFTP' : '收起 SFTP'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-[#27446a] bg-[#0a1628] px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-[#9fb9dc]">
                      <span>CPU</span>
                      <span>
                        {activeSessionSysStatus
                          ? `${clampPercent(activeSessionSysStatus.cpuUsagePercent).toFixed(1)}%`
                          : '--'}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#14253f]">
                      <div
                        className="h-full rounded bg-[#4fa8ff]"
                        style={{
                          width: `${clampPercent(activeSessionSysStatus?.cpuUsagePercent ?? 0)}%`
                        }}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#27446a] bg-[#0a1628] px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-[#9fb9dc]">
                      <span>内存</span>
                      <span>
                        {activeSessionSysStatus
                          ? `${clampPercent(activeSessionSysStatus.memoryUsagePercent).toFixed(1)}%`
                          : '--'}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded bg-[#14253f]">
                      <div
                        className="h-full rounded bg-[#6cdca1]"
                        style={{
                          width: `${clampPercent(activeSessionSysStatus?.memoryUsagePercent ?? 0)}%`
                        }}
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border border-[#27446a] bg-[#0a1628] px-3 py-2 text-[11px] text-[#9fb9dc]">
                    <div className="flex items-center justify-between">
                      <span>下行</span>
                      <span>{formatRate(activeSessionSysStatus?.netRxBytesPerSec ?? 0)}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span>上行</span>
                      <span>{formatRate(activeSessionSysStatus?.netTxBytesPerSec ?? 0)}</span>
                    </div>
                  </div>
                </div>

                {terminalError && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <p className="text-xs text-rose-400">{terminalError}</p>
                    <button
                      className="rounded border border-rose-300 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200 hover:bg-rose-500/20"
                      onClick={() => {
                        setIsInspectorOpen(true);
                      }}
                      type="button"
                    >
                      问问 AI 怎么修
                    </button>
                  </div>
                )}
                {reconnectMessage && <p className="mt-2 text-xs text-amber-300">{reconnectMessage}</p>}

                <div className="mt-3 flex flex-wrap gap-2">
                  {activeSessions.length === 0 ? (
                    <p className="text-xs text-[#8ca2c5]">暂无会话，请点击“新建标签”或在主机列表中连接。</p>
                  ) : (
                    activeSessions.map((session) => (
                      <div
                        className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                          activeSessionId === session.id
                            ? 'border-[#4f6f9d] bg-[#11203a] text-[#d7e5ff]'
                            : 'border-[#2a3f61] bg-[#0a1220] text-[#8fa5c7]'
                        }`}
                        key={session.id}
                      >
                        <button
                          className="max-w-[180px] truncate px-1 text-left"
                          onClick={() => {
                            setActiveSession(session.id);
                          }}
                          title={session.title}
                          type="button"
                        >
                          {session.title}
                        </button>
                        <button
                          className="rounded px-1 hover:bg-[#1b2d4a]"
                          onClick={() => {
                            void closeSession(session.id);
                          }}
                          title="关闭标签"
                          type="button"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-3 min-h-0 flex-1">
                  {activeSessions.length > 0 ? (
                    <div className="h-full">
                      {activeSessions.map((session) => {
                        const workspace = splitWorkspaces[session.id] ?? createDefaultWorkspace(session);
                        const isTabActive = activeSessionId === session.id;
                        return (
                          <div
                            className={`${isTabActive ? 'block' : 'hidden'} h-full`}
                            key={session.id}
                          >
                            <OrbitTerminal
                              activePaneId={workspace.activePaneId}
                              blurPx={terminalBlur}
                              borderColor={activeThemePreset.terminalBorder}
                              fontFamily={terminalFontFamily}
                              fontSize={terminalFontSize}
                              isTabActive={isTabActive}
                              layout={workspace.root}
                              onActivePaneChange={(paneId) => {
                                setActiveSession(session.id);
                                setActivePane(session.id, paneId);
                              }}
                              onPaneContextMenu={(event, paneId) => {
                                handlePaneContextMenu(event, session.id, paneId);
                              }}
                              onPaneInput={(paneSessionId, data) => {
                                handlePaneInput(session.id, paneSessionId, data);
                              }}
                              onPaneSessionClosed={(paneId, paneSessionId) => {
                                handlePaneSessionClosed(session.id, paneId, paneSessionId);
                              }}
                              onTerminalError={(message) => {
                                setTerminalError(message);
                              }}
                              surfaceHex={activeThemePreset.terminalSurfaceHex}
                              surfaceOpacity={terminalOpacity}
                              theme={activeThemePreset.terminalTheme}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-[#2b4264] bg-[#060b13] text-sm text-[#7f94b4]">
                      请选择一台主机并点击“连接”，或使用“新建标签”。
                    </div>
                  )}
                </div>
              </div>

              {!isSftpCollapsed && (
                <>
                  <div
                    aria-label="调整终端与 SFTP 分栏宽度"
                    className={`relative h-full w-2 shrink-0 rounded bg-[#223756] transition hover:bg-[#355a89] ${
                      isResizingSplit ? 'cursor-col-resize bg-[#4e78ab]' : 'cursor-col-resize'
                    }`}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      setIsResizingSplit(true);
                    }}
                    role="separator"
                  />
                  <div className="h-full shrink-0 overflow-hidden" style={{ width: `${sftpPanelWidth}px` }}>
                    <SftpManager
                      className="h-full"
                      onSendToTerminal={sendCommandToTerminal}
                      sessionId={activeTerminalSessionId}
                      syncRequest={sftpSyncRequest}
                    />
                  </div>
                </>
              )}

              {splitMenu && (
                <div
                  className="fixed z-[140] min-w-[180px] rounded-xl border border-[#385780] bg-[#0b1628]/95 p-1.5 shadow-2xl backdrop-blur"
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  style={{
                    left: splitMenu.x,
                    top: splitMenu.y
                  }}
                >
                  <button
                    className="block w-full rounded-lg border border-[#2d4870] bg-transparent px-2.5 py-1.5 text-left text-xs text-[#d8e8ff] hover:bg-[#173051]"
                    onClick={() => {
                      void handleSplitFromMenu('horizontal');
                    }}
                    type="button"
                  >
                    向右分屏
                  </button>
                  <button
                    className="mt-1 block w-full rounded-lg border border-[#2d4870] bg-transparent px-2.5 py-1.5 text-left text-xs text-[#d8e8ff] hover:bg-[#173051]"
                    onClick={() => {
                      void handleSplitFromMenu('vertical');
                    }}
                    type="button"
                  >
                    向下分屏
                  </button>
                  <button
                    className={`mt-1 block w-full rounded-lg border px-2.5 py-1.5 text-left text-xs ${
                      splitMenuCanCloseCurrent
                        ? 'border-[#2d4870] bg-transparent text-[#ffd7d7] hover:bg-[#3a1e2e]'
                        : 'cursor-not-allowed border-[#2b3d5a] bg-[#0c1524] text-[#6d83a6]'
                    }`}
                    disabled={!splitMenuCanCloseCurrent}
                    onClick={() => {
                      if (!splitMenuCanCloseCurrent || !splitMenu) {
                        return;
                      }
                      void handleClosePane(splitMenu.tabSessionId, splitMenu.paneId).finally(() => {
                        setSplitMenu(null);
                      });
                    }}
                    type="button"
                  >
                    关闭当前分屏
                  </button>
                </div>
              )}
            </section>
          )}
        </div>
      </section>

      <TransferCenter />

      {isHostWizardOpen && (
        <div className="fixed inset-0 z-[128] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="flex h-[min(88vh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/45 bg-[#f1f7ff]/95 shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between border-b border-white/60 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">新增主机向导</p>
                <p className="mt-1 text-sm text-slate-700">按步骤填写连接信息，保存后自动写入本地加密金库。</p>
              </div>
              <button
                className={toolbarButtonClass}
                onClick={handleCloseHostWizard}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto px-5 py-5">
              <StepIndicator currentStep={currentStep} />

              <div className="mt-4 rounded-2xl border border-white/65 bg-white/60 p-5">
                {currentStep === 1 && <Step1 />}
                {currentStep === 2 && <Step2 />}
                {currentStep === 3 && <Step3 />}
              </div>

              {submittedHost && (
                <div className="mt-4 space-y-3 rounded-2xl border border-emerald-200/70 bg-emerald-50/70 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-emerald-900">主机配置已保存</h2>
                    <div className="flex items-center gap-2">
                      <button
                        className="rounded-xl border border-emerald-300 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-800"
                        onClick={() => {
                          reset();
                        }}
                        type="button"
                      >
                        新建另一台主机
                      </button>
                      <button
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                        onClick={() => {
                          setIsHostWizardOpen(false);
                          setDashboardSection('hosts');
                        }}
                        type="button"
                      >
                        完成并关闭
                      </button>
                    </div>
                  </div>
                  <pre className="overflow-auto rounded-xl bg-slate-900/90 p-3 text-xs leading-6 text-slate-100">
                    {JSON.stringify(submittedHost, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {isNewTabModalOpen && (
        <div className="fixed inset-0 z-[129] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-3xl border border-white/35 bg-[#0c1627]/92 p-5 text-[#dceaff] shadow-2xl backdrop-blur-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8fb2e6]">新建标签</p>
                <p className="mt-1 text-sm text-[#b8cae6]">选择一台主机，创建新的终端会话标签。</p>
              </div>
              <button
                className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                onClick={() => {
                  setIsNewTabModalOpen(false);
                }}
                type="button"
              >
                关闭
              </button>
            </div>

            {hosts.length === 0 ? (
              <div className="mt-4 rounded-xl border border-[#28405f] bg-[#0a1629] p-4 text-sm text-[#a8c0e3]">
                当前没有可连接主机，请先新增主机。
                <div className="mt-3">
                  <button
                    className="rounded-lg border border-[#3f5b82] bg-[#11223a] px-3 py-1.5 text-xs font-medium text-[#e1eeff] hover:bg-[#193152]"
                    onClick={() => {
                      setIsNewTabModalOpen(false);
                      setIsHostWizardOpen(true);
                    }}
                    type="button"
                  >
                    前往新增主机
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mt-4 max-h-[320px] space-y-2 overflow-auto pr-1">
                  {hosts.map((host, index) => {
                    const hostId = buildHostKey(host);
                    const identity = identities.find((item) => item.id === host.identityId);
                    const isSelected = selectedTabHostId === hostId;
                    return (
                      <button
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                          isSelected
                            ? 'border-[#4d76ab] bg-[#1a3254]'
                            : 'border-[#2a3f5d] bg-[#0d1a2b]/75 hover:bg-[#13243f]'
                        }`}
                        key={`${hostId}-${index}`}
                        onClick={() => {
                          setSelectedTabHostId(hostId);
                        }}
                        type="button"
                      >
                        <p className="text-sm font-medium text-[#e1eeff]">
                          {host.basicInfo.name || `${host.basicInfo.address}:${host.basicInfo.port}`}
                        </p>
                        <p className="mt-1 text-xs text-[#9fb5d7]">
                          {(identity?.username ?? 'unknown')}@{host.basicInfo.address}:{host.basicInfo.port}
                        </p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    className="rounded-lg border border-[#39537a] bg-[#0f1726] px-3 py-1.5 text-xs font-medium text-[#d7e5ff] hover:bg-[#13203a]"
                    onClick={() => {
                      setIsNewTabModalOpen(false);
                    }}
                    type="button"
                  >
                    取消
                  </button>
                  <button
                    className="rounded-lg border border-[#4d76ab] bg-[#1a3254] px-3 py-1.5 text-xs font-semibold text-[#e2efff] hover:bg-[#24426b] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!selectedTabHost || isConnectingTerminal}
                    onClick={() => {
                      void handleConnectFromNewTabModal();
                    }}
                    type="button"
                  >
                    {isConnectingTerminal ? '连接中...' : '创建并连接'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <CommandPalette
        activeIndex={commandPaletteActiveIndex}
        items={commandPaletteItems}
        onActiveIndexChange={setCommandPaletteActiveIndex}
        onClose={handleCommandPaletteClose}
        onConfirm={handleCommandPaletteConfirm}
        onQueryChange={(value) => {
          setCommandPaletteQuery(value);
          setCommandPaletteActiveIndex(0);
        }}
        open={isCommandPaletteOpen}
        query={commandPaletteQuery}
      />

      <OrbitAiAssistant
        onClose={() => {
          setIsAiAssistantOpen(false);
        }}
        onFill={fillCommandIntoTerminal}
        open={isAiAssistantOpen}
        sessionId={activeTerminalSessionId}
      />

      <OrbitInspector
        appLogs={appLogs}
        healthReport={healthReport}
        logs={sshDiagnosticLogs}
        onAskAi={handleAskAiForSshFix}
        onClearAppLogs={clearAppLogs}
        onClose={() => {
          setIsInspectorOpen(false);
        }}
        onRefreshHealth={async () => {
          await performHealthCheck(true);
        }}
        open={isInspectorOpen}
        sessionId={activeTerminalSessionId}
        terminalError={terminalError}
      />

      <SettingsDrawer
        activeTerminalHostId={activeTerminalHostId}
        activeTerminalSessionId={activeTerminalSessionId}
        activeTerminalTitle={activeTerminalTitle}
        activeCategory={settingsCategory}
        focusSectionId={settingsFocusSectionId}
        focusSequence={settingsFocusSequence}
        onClose={() => {
          setIsSettingsOpen(false);
        }}
        onCategoryChange={(category) => {
          setSettingsCategory(category);
          setSettingsFocusSectionId(null);
          setSettingsFocusSequence((prev) => prev + 1);
        }}
        onOpenAbout={() => {
          setIsAboutOpen(true);
        }}
        onOpenCloudAuth={() => {
          setIsCloudAuthModalOpen(true);
          setSkippedCloudAuthForCurrentUnlock(false);
          setIsSettingsOpen(false);
        }}
        open={isSettingsOpen}
      />

      <AboutOrbitTermModal
        onClose={() => {
          setIsAboutOpen(false);
        }}
        open={isAboutOpen}
        releaseNotice={releaseNotice}
      />

      <HostEditDialog
        host={editingHost}
        identity={editingIdentity}
        isSaving={isSavingVault}
        linkedHostCount={editingLinkedHostCount}
        onClose={() => {
          setEditingHostId(null);
        }}
        onSubmit={handleSaveHostEdit}
        open={Boolean(editingHost)}
      />

      <CloudAuthModal
        onSkip={() => {
          setIsCloudAuthModalOpen(false);
          setSkippedCloudAuthForCurrentUnlock(true);
        }}
        onSuccess={() => {
          setIsCloudAuthModalOpen(false);
          setSkippedCloudAuthForCurrentUnlock(false);
        }}
        open={isCloudAuthModalOpen}
      />

      {isCloseWindowPromptOpen && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/45 bg-[#f1f7ff]/95 p-5 shadow-2xl backdrop-blur-2xl">
            <h3 className="text-base font-semibold text-slate-900">关闭 OrbitTerm</h3>
            <p className="mt-2 text-sm text-slate-600">
              你希望本次关闭窗口后“驻留系统托盘”还是“直接退出应用”？
            </p>
            <label className="mt-3 inline-flex items-center gap-2 text-xs text-slate-700">
              <input
                checked={rememberCloseActionChoice}
                className="h-4 w-4 accent-[#2f6df4]"
                onChange={(event) => setRememberCloseActionChoice(event.target.checked)}
                type="checkbox"
              />
              记住我的选择并设为默认
            </label>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setIsCloseWindowPromptOpen(false);
                }}
                type="button"
              >
                取消
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  if (rememberCloseActionChoice) {
                    setCloseWindowAction('tray');
                  }
                  setIsCloseWindowPromptOpen(false);
                  void appWindow.hide();
                }}
                type="button"
              >
                驻留系统托盘
              </button>
              <button
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                onClick={() => {
                  if (rememberCloseActionChoice) {
                    setCloseWindowAction('exit');
                  }
                  setIsCloseWindowPromptOpen(false);
                  allowWindowCloseRef.current = true;
                  void appWindow.close();
                }}
                type="button"
              >
                直接退出
              </button>
            </div>
          </div>
        </div>
      )}

      <Toaster closeButton expand position="top-right" richColors />
    </main>
  );
}

export default App;
