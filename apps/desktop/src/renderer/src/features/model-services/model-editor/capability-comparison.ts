import { createContext } from 'react';
import type { Capability } from '@frame-loom/contracts';

export const CapabilityComparison = createContext<{
  current: Capability;
  template: Capability;
} | null>(null);
