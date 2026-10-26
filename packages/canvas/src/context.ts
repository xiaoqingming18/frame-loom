import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { CanvasHost } from './host';
import type { NodeRegistry } from './registry/registry';
import type { CanvasActions, CanvasState, CanvasStore } from './store/store';

export interface CanvasContextValue {
  store: CanvasStore;
  registry: NodeRegistry;
  host: CanvasHost;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export const NodeActionsContext = createContext<{
  addConnected: (nodeId: string, screen: { x: number; y: number }) => void;
} | null>(null);

export function useCanvas(): CanvasContextValue {
  const value = useContext(CanvasContext);
  if (!value) throw new Error('画布组件必须位于 CanvasEditor 内');
  return value;
}

export function useCanvasState<T>(selector: (state: CanvasState & CanvasActions) => T): T {
  return useStore(useCanvas().store, selector);
}
