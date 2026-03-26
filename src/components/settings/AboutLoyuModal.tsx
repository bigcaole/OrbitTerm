import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { getAppVersion } from '../../services/appInfo';
import { openExternalLink } from '../../services/externalLink';
import { checkForUpdate, installAvailableUpdate, type UpdateCheckResult } from '../../services/updater';

type UpdatePhase = 'idle' | 'checking' | 'latest' | 'available' | 'installing' | 'installed' | 'error';

interface AboutLoyuModalProps {
  open: boolean;
  onClose: () => void;
}

const GITHUB_URL = 'https://github.com/bigcaole/OrbitTerm';
const WEBSITE_URL = 'https://orbitterm.app';

export function AboutLoyuModal({ open, onClose }: AboutLoyuModalProps): JSX.Element | null {
  const [version, setVersion] = useState<string>('0.1.2');
  const [phase, setPhase] = useState<UpdatePhase>('idle');
  const [updateHint, setUpdateHint] = useState<string>('可手动检查新版本。');
  const [availableVersion, setAvailableVersion] = useState<string>('');
  const [lastCheckResult, setLastCheckResult] = useState<UpdateCheckResult | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    let mounted = true;
    void getAppVersion()
      .then((nextVersion) => {
        if (mounted && nextVersion.trim()) {
          setVersion(nextVersion.trim());
        }
      })
      .catch(() => {
        if (mounted) {
          setVersion('0.1.2');
        }
      });

    return () => {
      mounted = false;
    };
  }, [open]);

  const updateStatusText = useMemo(() => {
    if (phase === 'available' && availableVersion) {
      return `检测到新版本 ${availableVersion}`;
    }
    return updateHint;
  }, [phase, updateHint, availableVersion]);

  if (!open) {
    return null;
  }

  const handleCheckUpdate = async (): Promise<void> => {
    setPhase('checking');
    setUpdateHint('正在检查更新...');
    setAvailableVersion('');
    setLastCheckResult(null);

    try {
      const result = await checkForUpdate(version);
      setLastCheckResult(result);
      if (result.shouldUpdate) {
        setPhase('available');
        setAvailableVersion(result.manifest?.version ?? '未知版本');
        setUpdateHint(
          result.channel === 'tauri'
            ? '发现可用更新，可立即下载安装。'
            : '发现可用更新，可打开下载链接获取最新版安装包。'
        );
        return;
      }

      setPhase('latest');
      setUpdateHint('当前已是最新版本。');
    } catch (_error) {
      setPhase('error');
      setUpdateHint('更新检查失败，请确认更新地址与签名配置。');
    }
  };

  const handleInstallUpdate = async (): Promise<void> => {
    if (phase !== 'available' || !lastCheckResult) {
      return;
    }

    setPhase('installing');
    setUpdateHint(
      lastCheckResult.channel === 'tauri' ? '正在下载并安装更新...' : '正在打开最新版本下载链接...'
    );

    try {
      await installAvailableUpdate(lastCheckResult);
      if (lastCheckResult.channel === 'tauri') {
        setPhase('installed');
        setUpdateHint('更新安装完成，请重启应用以生效。');
        toast.success('更新安装完成', {
          description: '请手动重启 OrbitTerm。'
        });
      } else {
        setPhase('available');
        setUpdateHint('已打开下载链接，请安装后覆盖当前版本。');
        toast.success('已打开下载页面');
      }
    } catch (_error) {
      setPhase('error');
      setUpdateHint('安装更新失败，请稍后重试。');
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl border border-white/30 bg-[#0a1321]/85 p-6 text-slate-100 shadow-2xl backdrop-blur-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8fb2e6]">About OrbitTerm</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">关于轨连终端</h2>
            <p className="mt-2 text-sm text-[#b7c9e7]">版本 {version} · 为高强度运维与安全连接而生。</p>
          </div>
          <button
            className="rounded-lg border border-[#314969] bg-[#111f34] px-3 py-1.5 text-xs text-[#c7d8f3] hover:bg-[#162946]"
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
            <h3 className="text-sm font-semibold text-[#dceaff]">致谢</h3>
            <p className="mt-2 text-xs leading-6 text-[#9fb5d7]">
              OrbitTerm 基于 React、Tauri、Rust、xterm.js 与 russh 构建，感谢所有开源维护者。
            </p>
          </section>

          <section className="rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
            <h3 className="text-sm font-semibold text-[#dceaff]">链接</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-[#35547d] bg-[#12233a] px-3 py-1.5 text-xs font-medium text-[#d4e5ff] hover:bg-[#193152]"
                onClick={() => {
                  void openExternalLink(GITHUB_URL);
                }}
                type="button"
              >
                GitHub
              </button>
              <button
                className="rounded-lg border border-[#35547d] bg-[#12233a] px-3 py-1.5 text-xs font-medium text-[#d4e5ff] hover:bg-[#193152]"
                onClick={() => {
                  void openExternalLink(WEBSITE_URL);
                }}
                type="button"
              >
                官网
              </button>
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#dceaff]">更新检查</h3>
              <p className="mt-1 text-xs text-[#9fb5d7]">{updateStatusText}</p>
            </div>
            <div className="flex gap-2">
              <button
                className="rounded-lg border border-[#35547d] bg-[#12233a] px-3 py-1.5 text-xs font-medium text-[#d4e5ff] hover:bg-[#193152] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={phase === 'checking' || phase === 'installing'}
                onClick={() => {
                  void handleCheckUpdate();
                }}
                type="button"
              >
                {phase === 'checking' ? '检查中...' : '检查更新'}
              </button>
              <button
                className="rounded-lg border border-[#4d76ab] bg-[#1a3254] px-3 py-1.5 text-xs font-medium text-[#e2efff] hover:bg-[#24426b] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={phase !== 'available' && phase !== 'installing'}
                onClick={() => {
                  void handleInstallUpdate();
                }}
                type="button"
              >
                {phase === 'installing'
                  ? '处理中...'
                  : lastCheckResult?.channel === 'github'
                  ? '打开下载页'
                  : '下载安装'}
              </button>
            </div>
          </div>
          <p className="mt-3 text-[11px] leading-5 text-[#8aa4cb]">
            更新包来自静态 JSON 更新服务，发布前请在 `tauri.conf.json` 中配置正确的 `updater.endpoints` 与签名 `pubkey`。
          </p>
        </section>
      </div>
    </div>
  );
}
