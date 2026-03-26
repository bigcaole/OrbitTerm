import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { step2Schema, type Step2FormValues } from '../../schemas/hostSchemas';
import { useHostStore } from '../../store/useHostStore';
import { Tooltip } from './Tooltip';

const inputClassName =
  'w-full rounded-xl border border-white/65 bg-white/70 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-frost-accent/60 focus:ring-2 focus:ring-frost-accent/20';

export function Step2(): JSX.Element {
  const basicInfo = useHostStore((state) => state.basicInfo);
  const identities = useHostStore((state) => state.identities);
  const authConfig = useHostStore((state) => state.authConfig);
  const updateAuthConfig = useHostStore((state) => state.updateAuthConfig);
  const nextStep = useHostStore((state) => state.nextStep);
  const prevStep = useHostStore((state) => state.prevStep);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm<Step2FormValues>({
    resolver: zodResolver(step2Schema),
    defaultValues: authConfig,
    mode: 'onBlur'
  });

  const method = watch('method');
  const selectedIdentity = identities.find((identity) => identity.id === basicInfo.identityId);

  if (basicInfo.identityMode === 'existing') {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-white/60 bg-white/55 p-4">
          <h3 className="text-sm font-semibold text-slate-800">已复用身份</h3>
          {selectedIdentity ? (
            <p className="mt-2 text-sm text-slate-700">
              当前主机将使用身份「{selectedIdentity.name}」，登录用户为 {selectedIdentity.username}。
            </p>
          ) : (
            <p className="mt-2 text-sm text-rose-600">未找到已选身份，请返回上一步重新选择。</p>
          )}
          <p className="mt-2 text-xs text-slate-600">
            身份认证信息由身份中心统一维护，修改后会自动影响所有关联主机。
          </p>
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
            disabled={!selectedIdentity}
            onClick={nextStep}
            type="button"
          >
            下一步：高级选项
          </button>
        </div>
      </div>
    );
  }

  const onSubmit = (values: Step2FormValues): void => {
    updateAuthConfig(values);
    nextStep();
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
      <div className="space-y-3 rounded-2xl border border-white/60 bg-white/55 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          认证方式
          <Tooltip content="推荐生产环境使用“私钥认证”。密码认证配置简单，但安全性依赖口令强度与策略。" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/70 bg-white/70 p-3 text-sm text-slate-700">
            <input type="radio" value="password" {...register('method')} />
            密码认证
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/70 bg-white/70 p-3 text-sm text-slate-700">
            <input type="radio" value="privateKey" {...register('method')} />
            私钥认证
          </label>
        </div>
      </div>

      {method === 'password' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            登录密码
            <Tooltip content="用于 SSH 密码认证。建议使用高强度口令并配合失败锁定策略，避免在共享设备中明文保存。" />
          </label>
          <input className={inputClassName} placeholder="请输入登录密码" type="password" {...register('password')} />
          {errors.password && <p className="text-xs text-rose-500">{errors.password.message}</p>}
        </div>
      )}

      {method === 'privateKey' && (
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              私钥内容
              <Tooltip content="粘贴完整私钥（通常以 -----BEGIN OPENSSH PRIVATE KEY----- 开头）。请确保权限受控，不要上传到公共仓库。" />
            </label>
            <textarea
              className={`${inputClassName} min-h-[140px] font-mono text-xs`}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              {...register('privateKey')}
            />
            {errors.privateKey && <p className="text-xs text-rose-500">{errors.privateKey.message}</p>}
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              私钥口令 (可选)
              <Tooltip content="如果私钥加密过，请填写解密口令。未加密私钥可留空。口令仅用于本次配置加密存储。" />
            </label>
            <input className={inputClassName} placeholder="可留空" type="password" {...register('passphrase')} />
            {errors.passphrase && <p className="text-xs text-rose-500">{errors.passphrase.message}</p>}
          </div>
        </div>
      )}

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
          type="submit"
        >
          下一步：高级选项
        </button>
      </div>
    </form>
  );
}
