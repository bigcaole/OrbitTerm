export type AuthMethod = 'password' | 'privateKey';

export interface HostBasicInfo {
  name: string;
  address: string;
  port: number;
  description: string;
}

export interface HostAuthConfig {
  method: AuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface IdentityConfig {
  id: string;
  name: string;
  username: string;
  authConfig: HostAuthConfig;
}

export interface HostAdvancedOptions {
  jumpHost: string;
  proxyJumpHostId: string;
  connectionTimeout: number;
  keepAliveEnabled: boolean;
  keepAliveInterval: number;
  compression: boolean;
  strictHostKeyChecking: boolean;
  tags: string[];
}

export interface HostConfig {
  basicInfo: HostBasicInfo;
  identityId: string;
  advancedOptions: HostAdvancedOptions;
}

export interface Snippet {
  id: string;
  title: string;
  command: string;
  tags: string[];
}
