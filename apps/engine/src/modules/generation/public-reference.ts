import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // 只接受全球单播；映射 IPv4、环回、链路本地和 ULA 均不属于此范围。
  return family === 6 && /^[23]/.test(address) && !blocked.check(address, 'ipv6');
}

export async function publicReference(value: string) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('素材必须使用无内嵌凭据的公网 HTTP(S) 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || !addresses.every(({ address }) => isPublicAddress(address)))
    throw new Error('素材地址不能解析到私网或保留地址');
  return url.toString();
}
