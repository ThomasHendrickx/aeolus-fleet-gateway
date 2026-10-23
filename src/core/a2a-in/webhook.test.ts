import { describe, expect, it } from 'vitest';

import { isPublicAddress, webhookUrlOf } from './webhook.js';

describe("an A2A client's webhook URL (slice 4)", () => {
  it('takes an https URL with a host', () => {
    expect(webhookUrlOf('https://hooks.supplier.example/a2a?x=1')).toMatchObject({ isOk: true, value: { host: 'hooks.supplier.example' } });
  });

  it.each(['http://hooks.supplier.example/a2a', 'ftp://hooks.supplier.example', 'not a url', 'https://user:secret@hooks.supplier.example/'])('refuses %s', (url) => {
    expect(webhookUrlOf(url)).toMatchObject({ isOk: false, error: { kind: 'WEBHOOK_REFUSED' } });
  });
});

describe('a public address, which alone a webhook may be reached at (slice 4)', () => {
  it.each(['93.184.215.14', '8.8.8.8', '172.32.0.1', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'])('takes %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback', '127.255.0.9'],
    ['private', '10.0.0.5'],
    ['private', '172.16.0.1'],
    ['private', '172.31.255.255'],
    ['private', '192.168.1.1'],
    ['shared', '100.64.0.1'],
    ['link-local, cloud metadata', '169.254.169.254'],
    ['unspecified', '0.0.0.0'],
    ['multicast', '224.0.0.1'],
    ['reserved', '240.0.0.1'],
    ['broadcast', '255.255.255.255'],
    ['IPv6 loopback', '::1'],
    ['IPv6 unspecified', '::'],
    ['IPv6 unique-local', 'fd00::1'],
    ['IPv6 unique-local', 'fc12:3456::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv4-mapped private', '::ffff:10.0.0.5'],
    ['IPv4-mapped loopback', '::ffff:7f00:1'],
    ['not an address', 'hooks.supplier.example'],
  ])('refuses %s %s', (_kind, address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
});
