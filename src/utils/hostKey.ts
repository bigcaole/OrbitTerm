import type { HostConfig } from '../types/host';

export const buildHostKey = (host: HostConfig): string => {
  return `${host.identityId}::${host.basicInfo.address}:${host.basicInfo.port}::${host.basicInfo.name}`;
};
