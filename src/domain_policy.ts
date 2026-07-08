/**
 * Domain Policy
 *
 * Allow/deny lists for the fetch tool. Loaded from config/domain_policy.json.
 * Default policy: deny-RFC1918 + deny-known-malicious + allow-everything-else.
 *
 *
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, '../config/domain_policy.json');

export interface DomainPolicy {
  version: string;
  description: string;
  defaultAction: 'allow' | 'deny';
  allowlist: string[];
  denylist: string[];
  denyPrivate: boolean;
  denyKnownMalicious: boolean;
  knownMalicious: string[];
}

export function loadDomainPolicy(path = POLICY_PATH): DomainPolicy {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as DomainPolicy;
  return {
    version: raw.version ?? '1.0',
    description: raw.description ?? '',
    defaultAction: raw.defaultAction ?? 'allow',
    allowlist: raw.allowlist ?? [],
    denylist: raw.denylist ?? [],
    denyPrivate: raw.denyPrivate ?? true,
    denyKnownMalicious: raw.denyKnownMalicious ?? true,
    knownMalicious: raw.knownMalicious ?? [],
  };
}

/** For v1.0: deny private + known malicious; allow everything else. */
export const DEFAULT_POLICY: DomainPolicy = {
  version: '1.0',
  description: 'Deny private/local IPs and known-malicious domains; allow everything else.',
  defaultAction: 'allow',
  allowlist: [],
  denylist: [
    'metadata.google.internal',
    '169.254.169.254',
    '*.internal',
    '*.local',
  ],
  denyPrivate: true,
  denyKnownMalicious: true,
  knownMalicious: [
    'evil.com',
    'malware.example',
    'phishing.example',
  ],
};
