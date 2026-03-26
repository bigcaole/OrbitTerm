import { z } from 'zod';

const hostPattern = /^(?!-)([a-zA-Z0-9-]{1,63}\.)*[a-zA-Z0-9-]{1,63}$|^((25[0-5]|2[0-4]\d|1?\d?\d)(\.|$)){4}$|^\[[0-9a-fA-F:]+\]$/;

export const step1Schema = z
  .object({
    name: z.string().min(2, '主机名称至少需要 2 个字符').max(50, '主机名称不能超过 50 个字符'),
    address: z
      .string()
      .min(2, '请输入有效的主机地址')
      .max(255, '主机地址过长')
      .refine((value) => hostPattern.test(value), '请输入合法的域名、IPv4 或 [IPv6] 地址'),
    port: z.coerce.number().int('端口必须为整数').min(1, '端口最小为 1').max(65535, '端口最大为 65535'),
    description: z.string().max(160, '备注不能超过 160 个字符').default(''),
    identityMode: z.enum(['existing', 'new']).default('new'),
    identityId: z.string().default(''),
    identityName: z.string().max(50, '身份名称不能超过 50 个字符').default(''),
    identityUsername: z.string().max(64, '身份用户名不能超过 64 个字符').default('')
  })
  .superRefine((data, ctx) => {
    if (data.identityMode === 'existing' && !data.identityId.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['identityId'],
        message: '请选择一个已有身份'
      });
    }

    if (data.identityMode === 'new') {
      if (data.identityName.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['identityName'],
          message: '新身份名称至少需要 2 个字符'
        });
      }

      if (data.identityUsername.trim().length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['identityUsername'],
          message: '请输入新身份的登录用户名'
        });
      }
    }
  });

export const step2Schema = z
  .object({
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
      if (pwd.length < 6) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: '密码至少需要 6 位'
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

export const step3Schema = z.object({
  jumpHost: z.string().max(128, '跳板机地址不能超过 128 个字符').default(''),
  proxyJumpHostId: z.string().default(''),
  connectionTimeout: z.coerce.number().int('连接超时必须是整数').min(1, '连接超时至少 1 秒').max(120, '连接超时不能超过 120 秒'),
  keepAliveEnabled: z.boolean().default(true),
  keepAliveInterval: z.coerce.number().int('KeepAlive 间隔必须是整数').min(5, 'KeepAlive 最小间隔为 5 秒').max(600, 'KeepAlive 最大间隔为 600 秒'),
  compression: z.boolean().default(true),
  strictHostKeyChecking: z.boolean().default(true),
  tagsText: z.string().max(120, '标签总长度不能超过 120 个字符').default('')
});

export const identitySchema = z.object({
  id: z.string().min(1, '身份 ID 不能为空'),
  name: z.string().min(2, '身份名称至少需要 2 个字符').max(50, '身份名称不能超过 50 个字符'),
  username: z.string().min(1, '身份用户名不能为空').max(64, '身份用户名不能超过 64 个字符'),
  authConfig: step2Schema
});

export const finalHostSchema = z.object({
  basicInfo: z.object({
    name: z.string().min(2).max(50),
    address: z.string().min(2).max(255),
    port: z.number().int().min(1).max(65535),
    description: z.string().max(160)
  }),
  identityId: z.string().min(1, '请绑定一个身份'),
  advancedOptions: z.object({
    jumpHost: z.string(),
    proxyJumpHostId: z.string(),
    connectionTimeout: z.number(),
    keepAliveEnabled: z.boolean(),
    keepAliveInterval: z.number(),
    compression: z.boolean(),
    strictHostKeyChecking: z.boolean(),
    tags: z.array(z.string().min(1).max(20)).max(10)
  })
});

export type Step1FormValues = z.infer<typeof step1Schema>;
export type Step2FormValues = z.infer<typeof step2Schema>;
export type Step3FormValues = z.infer<typeof step3Schema>;
export type IdentityFormValues = z.infer<typeof identitySchema>;
