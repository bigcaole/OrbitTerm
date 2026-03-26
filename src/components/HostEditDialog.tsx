import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import type { HostConfig, IdentityConfig } from '../types/host';
import { hostPattern } from '../schemas/hostSchemas';

const editHostSchema = z
  .object({
    name: z.string().max(50, '主机名称不能超过 50 个字符').default(''),
    address: z
      .string()
      .min(2, '请输入有效的主机地址')
      .max(255, '主机地址过长')
      .refine((value) => hostPattern.test(value), '请输入合法的域名、IPv4 或 [IPv6] 地址'),
    port: z.coerce.number().int('端口必须是整数').min(1, '端口最小为 1').max(65535, '端口最大为 65535'),
    description: z.string().max(160, '备注不能超过 160 个字符').default(''),
    identityName: z.string().max(50, '身份名称不能超过 50 个字符').default(''),
    identityUsername: z.string().min(1, '请输入登录用户名').max(64, '用户名不能超过 64 个字符'),
    method: z.enum(['password', 'privateKey'], {
      required_error: '请选择认证方式'
    }),
    password: z.string().optional(),
    privateKey: z.string().optional(),
    passphrase: z.string().optional()
  })
  .superRefine((data, ctx) => {
    if (data.method === 'password') {
      const pwd = data.password?.trim() ?? '';
      if (pwd.length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: '请输入登录密码'
        });
      }
    }

    if (data.method === 'privateKey') {
      const key = data.privateKey?.trim() ?? '';
      if (key.length < 20) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['privateKey'],
          message: '私钥内容过短，请粘贴完整私钥'
        });
      }
    }
  });

export type HostEditFormValues = z.infer<typeof editHostSchema>;

interface HostEditDialogProps {
  open: boolean;
  host: HostConfig | null;
  identity: IdentityConfig | null;
  linkedHostCount: number;
  isSaving: boolean;
  onClose: () => void;
  onSubmit: (values: HostEditFormValues) => Promise<void>;
}

const inputClassName =
  'w-full rounded-xl border border-white/65 bg-white/70 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-frost-accent/60 focus:ring-2 focus:ring-frost-accent/20';

export function HostEditDialog({
  open,
  host,
  identity,
  linkedHostCount,
  isSaving,
  onClose,
  onSubmit
}: HostEditDialogProps): JSX.Element | null {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors }
  } = useForm<HostEditFormValues>({
    resolver: zodResolver(editHostSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      address: '',
      port: 22,
      description: '',
      identityName: '',
      identityUsername: '',
      method: 'password',
      password: '',
      privateKey: '',
      passphrase: ''
    }
  });

  useEffect(() => {
    if (!open || !host || !identity) {
      return;
    }

    reset({
      name: host.basicInfo.name,
      address: host.basicInfo.address,
      port: host.basicInfo.port,
      description: host.basicInfo.description,
      identityName: identity.name,
      identityUsername: identity.username,
      method: identity.authConfig.method,
      password: identity.authConfig.password ?? '',
      privateKey: identity.authConfig.privateKey ?? '',
      passphrase: identity.authConfig.passphrase ?? ''
    });
  }, [open, host, identity, reset]);

  const method = watch('method');

  if (!open || !host || !identity) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl rounded-3xl border border-white/30 bg-[#0a1321]/88 p-6 text-slate-100 shadow-2xl backdrop-blur-2xl sm:p-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8fb2e6]">Host Manager</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">编辑主机</h2>
            <p className="mt-2 text-xs text-[#a7c0e2]">
              若该身份被多台主机共用，修改认证会同步到所有关联主机（当前共 {linkedHostCount} 台）。
            </p>
          </div>
          <button
            className="rounded-lg border border-[#314969] bg-[#111f34] px-3 py-1.5 text-xs text-[#c7d8f3] hover:bg-[#162946]"
            disabled={isSaving}
            onClick={onClose}
            type="button"
          >
            关闭
          </button>
        </div>

        <form
          className="mt-5 space-y-5"
          onSubmit={handleSubmit((values) => {
            void onSubmit(values);
          })}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">主机名称（可选）</label>
              <input className={inputClassName} placeholder="留空将自动使用 地址:端口" {...register('name')} />
              {errors.name && <p className="text-xs text-rose-300">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">备注</label>
              <input className={inputClassName} placeholder="例如：生产集群入口" {...register('description')} />
              {errors.description && <p className="text-xs text-rose-300">{errors.description.message}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">主机地址</label>
              <input className={inputClassName} placeholder="例如：10.0.0.8" {...register('address')} />
              {errors.address && <p className="text-xs text-rose-300">{errors.address.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">端口</label>
              <input className={inputClassName} type="number" {...register('port')} />
              {errors.port && <p className="text-xs text-rose-300">{errors.port.message}</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">身份名称（可选）</label>
              <input className={inputClassName} placeholder="留空将自动生成" {...register('identityName')} />
              {errors.identityName && <p className="text-xs text-rose-300">{errors.identityName.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">登录用户名</label>
              <input className={inputClassName} placeholder="例如：root" {...register('identityUsername')} />
              {errors.identityUsername && <p className="text-xs text-rose-300">{errors.identityUsername.message}</p>}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-[#2a3f5d] bg-[#0d1a2b]/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">认证方式</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-xl border border-[#35547d] bg-[#12233a] p-3 text-sm text-[#d4e5ff]">
                <input type="radio" value="password" {...register('method')} />
                密码认证
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-[#35547d] bg-[#12233a] p-3 text-sm text-[#d4e5ff]">
                <input type="radio" value="privateKey" {...register('method')} />
                私钥认证
              </label>
            </div>

            {method === 'password' && (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">登录密码</label>
                <input className={inputClassName} placeholder="请输入登录密码" type="password" {...register('password')} />
                {errors.password && <p className="text-xs text-rose-300">{errors.password.message}</p>}
              </div>
            )}

            {method === 'privateKey' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">私钥内容</label>
                  <textarea
                    className={`${inputClassName} min-h-[120px] font-mono text-xs`}
                    placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    {...register('privateKey')}
                  />
                  {errors.privateKey && <p className="text-xs text-rose-300">{errors.privateKey.message}</p>}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.14em] text-[#95b0d8]">私钥口令（可选）</label>
                  <input className={inputClassName} placeholder="可留空" type="password" {...register('passphrase')} />
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              className="rounded-lg border border-[#35547d] bg-[#12233a] px-4 py-2 text-sm text-[#d4e5ff] hover:bg-[#193152]"
              disabled={isSaving}
              onClick={onClose}
              type="button"
            >
              取消
            </button>
            <button
              className="rounded-lg border border-[#4d76ab] bg-[#1a3254] px-4 py-2 text-sm font-semibold text-[#e2efff] hover:bg-[#24426b] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              type="submit"
            >
              {isSaving ? '保存中...' : '保存更改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
