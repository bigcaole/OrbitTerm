import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { step1Schema, type Step1FormValues } from '../../schemas/hostSchemas';
import { useHostStore } from '../../store/useHostStore';
import { Tooltip } from './Tooltip';

const inputClassName =
  'w-full rounded-xl border border-white/65 bg-white/70 px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-frost-accent/60 focus:ring-2 focus:ring-frost-accent/20';

export function Step1(): JSX.Element {
  const basicInfo = useHostStore((state) => state.basicInfo);
  const identities = useHostStore((state) => state.identities);
  const updateBasicInfo = useHostStore((state) => state.updateBasicInfo);
  const nextStep = useHostStore((state) => state.nextStep);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors }
  } = useForm<Step1FormValues>({
    resolver: zodResolver(step1Schema),
    defaultValues: basicInfo,
    mode: 'onBlur'
  });

  const identityMode = watch('identityMode');
  const hasIdentities = identities.length > 0;

  const onSubmit = (values: Step1FormValues): void => {
    if (values.identityMode === 'existing' && !hasIdentities) {
      values.identityMode = 'new';
      values.identityId = '';
    }
    updateBasicInfo(values);
    nextStep();
  };

  return (
    <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
      <div className="rounded-2xl border border-white/70 bg-white/60 p-4 text-xs leading-6 text-slate-600">
        快速添加只需：主机地址 + 端口 + 登录用户名 + 认证信息。主机名称与身份名称可留空，系统会自动生成。
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          主机名称 (可选)
          <Tooltip content="用于在罗屿终端中识别该主机。可留空，系统会自动使用“地址:端口”作为默认名称。" />
        </label>
        <input className={inputClassName} placeholder="可留空，默认使用 地址:端口" {...register('name')} />
        {errors.name && <p className="text-xs text-rose-500">{errors.name.message}</p>}
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          主机地址
          <Tooltip content="支持域名、IPv4 或 [IPv6]。该地址是客户端发起 SSH 连接的目标地址，请确保 DNS 或网络路由可达。" />
        </label>
        <input className={inputClassName} placeholder="例如：10.10.10.8 或 host.example.com" {...register('address')} />
        {errors.address && <p className="text-xs text-rose-500">{errors.address.message}</p>}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            端口
            <Tooltip content="SSH 默认端口为 22。若服务端已做安全加固修改，请填写实际监听端口。可用范围为 1-65535。" />
          </label>
          <input className={inputClassName} type="number" {...register('port')} />
          {errors.port && <p className="text-xs text-rose-500">{errors.port.message}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          备注说明
          <Tooltip content="可填写该主机用途、负责人或变更窗口信息，方便团队后续维护。此字段不会影响连接行为。" />
        </label>
        <textarea
          className={`${inputClassName} min-h-[92px] resize-y`}
          placeholder="例如：用于订单服务，负责人 @ops-team"
          {...register('description')}
        />
        {errors.description && <p className="text-xs text-rose-500">{errors.description.message}</p>}
      </div>

      <div className="space-y-3 rounded-2xl border border-white/60 bg-white/55 p-4">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
          身份绑定
          <Tooltip content="身份用于集中管理登录用户与认证材料。主机只关联身份，后续改一次身份密钥即可同步到所有关联主机。" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/70 bg-white/70 p-3 text-sm text-slate-700">
            <input
              disabled={!hasIdentities}
              type="radio"
              value="existing"
              {...register('identityMode')}
            />
            选择已有身份
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-white/70 bg-white/70 p-3 text-sm text-slate-700">
            <input type="radio" value="new" {...register('identityMode')} />
            新建身份
          </label>
        </div>

        {identityMode === 'existing' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              已有身份
              <Tooltip content="选择一个已保存身份，后续主机会复用该身份的用户名和认证方式。" />
            </label>
            <select className={inputClassName} {...register('identityId')}>
              <option value="">{hasIdentities ? '请选择身份' : '暂无身份，请改为新建身份'}</option>
              {identities.map((identity) => (
                <option key={identity.id} value={identity.id}>
                  {identity.name} ({identity.username})
                </option>
              ))}
            </select>
            {errors.identityId && <p className="text-xs text-rose-500">{errors.identityId.message}</p>}
          </div>
        )}

        {identityMode === 'new' && (
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                新身份名称 (可选)
                <Tooltip content="例如“生产服务器密钥”。可留空，系统将自动按“用户名@地址”生成。" />
              </label>
              <input className={inputClassName} placeholder="可留空，自动生成" {...register('identityName')} />
              {errors.identityName && <p className="text-xs text-rose-500">{errors.identityName.message}</p>}
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                身份用户名
                <Tooltip content="该身份连接主机时使用的系统账号，如 root、ubuntu、ec2-user。" />
              </label>
              <input className={inputClassName} placeholder="例如：root" {...register('identityUsername')} />
              {errors.identityUsername && <p className="text-xs text-rose-500">{errors.identityUsername.message}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-end pt-2">
        <button
          className="rounded-xl bg-frost-accent px-5 py-2.5 text-sm font-semibold text-white shadow-panel transition hover:bg-[#0c73da]"
          type="submit"
        >
          下一步：认证配置
        </button>
      </div>
    </form>
  );
}
