import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { step3Schema, type Step3FormValues } from '../../schemas/hostSchemas';
import { useHostStore } from '../../store/useHostStore';
import { buildHostKey } from '../../utils/hostKey';
import { Tooltip } from './Tooltip';

const inputClassName =
  'w-full rounded-xl border border-white/65 bg-white/70 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-frost-accent/60 focus:ring-2 focus:ring-frost-accent/20';

export function Step3(): JSX.Element {
  const advancedOptions = useHostStore((state) => state.advancedOptions);
  const updateAdvancedOptions = useHostStore((state) => state.updateAdvancedOptions);
  const submitHost = useHostStore((state) => state.submitHost);
  const prevStep = useHostStore((state) => state.prevStep);
  const isSavingVault = useHostStore((state) => state.isSavingVault);
  const hosts = useHostStore((state) => state.hosts);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<Step3FormValues>({
    resolver: zodResolver(step3Schema),
    defaultValues: advancedOptions,
    mode: 'onBlur'
  });

  const onSubmit = async (values: Step3FormValues): Promise<void> => {
    updateAdvancedOptions(values);
    await submitHost();
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
      <div className="rounded-2xl border border-white/70 bg-white/60 p-4 text-xs leading-6 text-slate-600">
        默认高级策略已预设（10 秒超时、KeepAlive 开启、压缩开启、严格指纹校验）。你可以直接保存，或展开高级参数自定义。
        <button
          className="ml-2 rounded-lg border border-white/80 bg-white/70 px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-white"
          onClick={() => {
            setShowAdvanced((prev) => !prev);
          }}
          type="button"
        >
          {showAdvanced ? '收起高级参数' : '展开高级参数'}
        </button>
      </div>

      <div className={showAdvanced ? 'space-y-5' : 'hidden'}>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          选择跳板机 (推荐)
          <Tooltip content="从现有主机中选一个作为 ProxyJump。支持多级链路：若该跳板机本身也配置了跳板，将自动级联连接。" />
        </label>
        <select className={inputClassName} {...register('proxyJumpHostId')}>
          <option value="">不使用已存主机作为跳板</option>
          {hosts.map((host) => (
            <option key={buildHostKey(host)} value={buildHostKey(host)}>
              {host.basicInfo.name} ({host.basicInfo.address}:{host.basicInfo.port})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          手动跳板地址 (可选)
          <Tooltip content="可手动输入 host:port 作为跳板地址。若已选择“跳板机主机”，该项将作为备用方案。" />
        </label>
        <input className={inputClassName} placeholder="例如：bastion.example.com:22" {...register('jumpHost')} />
        {errors.jumpHost && <p className="text-xs text-rose-500">{errors.jumpHost.message}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            连接超时 (秒)
            <Tooltip content="发起连接后的等待上限。网络波动较大的跨地域链路可适当提高，避免过早超时。" />
          </label>
          <input className={inputClassName} type="number" {...register('connectionTimeout')} />
          {errors.connectionTimeout && <p className="text-xs text-rose-500">{errors.connectionTimeout.message}</p>}
        </div>

        <div className="space-y-2">
          <label className="flex items-center justify-between rounded-xl border border-white/65 bg-white/60 p-3 text-sm text-slate-700">
            启用 KeepAlive
            <Tooltip content="开启后会按设定间隔发送保活空包，减少网络设备导致的“假死”断连。" />
            <input type="checkbox" {...register('keepAliveEnabled')} />
          </label>
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            KeepAlive 间隔 (秒)
            <Tooltip content="周期发送保活包，降低长连接被中间网络设备回收的概率。建议在 30-120 秒之间。" />
          </label>
          <input className={inputClassName} type="number" {...register('keepAliveInterval')} />
          {errors.keepAliveInterval && <p className="text-xs text-rose-500">{errors.keepAliveInterval.message}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex items-center justify-between rounded-xl border border-white/65 bg-white/60 p-3 text-sm text-slate-700">
          启用压缩
          <Tooltip content="启用 SSH 压缩可在低带宽场景提升传输效率，但会增加本地和远端 CPU 开销。" />
          <input type="checkbox" {...register('compression')} />
        </label>

        <label className="flex items-center justify-between rounded-xl border border-white/65 bg-white/60 p-3 text-sm text-slate-700">
          严格主机指纹校验
          <Tooltip content="开启后会校验远端主机指纹，防止中间人攻击。生产环境建议保持开启。" />
          <input type="checkbox" {...register('strictHostKeyChecking')} />
        </label>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          标签 (可选)
          <Tooltip content="使用逗号分隔多个标签，例如“生产,数据库,华东”。标签可用于后续检索、分组和策略编排。" />
        </label>
        <input className={inputClassName} placeholder="例如：生产,数据库,华东" {...register('tagsText')} />
        {errors.tagsText && <p className="text-xs text-rose-500">{errors.tagsText.message}</p>}
      </div>
      </div>

      <div className="flex justify-between pt-2">
        <button
          className="rounded-xl border border-white/70 bg-white/70 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-white"
          onClick={prevStep}
          type="button"
        >
          上一步
        </button>
        <button
          className="rounded-xl bg-frost-accent px-5 py-2.5 text-sm font-semibold text-white shadow-panel transition hover:bg-[#0c73da]"
          disabled={isSavingVault}
          type="submit"
        >
          {isSavingVault ? '保存中...' : '完成并保存主机'}
        </button>
      </div>
    </form>
  );
}
