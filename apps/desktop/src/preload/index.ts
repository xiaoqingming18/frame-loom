import { contextBridge, ipcRenderer } from 'electron';
import type { ThemeSource, WindowCommand } from '@frame-loom/contracts';

contextBridge.exposeInMainWorld('frameLoom', {
  getEngineConnection: (): Promise<unknown> => ipcRenderer.invoke('engine:connection'),
  onEngineExited: (callback: (code: unknown) => void): (() => void) => {
    const listener = (_event: unknown, code: unknown) => callback(code);
    ipcRenderer.on('engine:exited', listener);
    return () => {
      ipcRenderer.removeListener('engine:exited', listener);
    };
  },
  theme: {
    get: (): Promise<unknown> => ipcRenderer.invoke('theme:get'),
    set: (source: ThemeSource): Promise<unknown> => ipcRenderer.invoke('theme:set', source),
  },
  window: {
    command: (name: WindowCommand): Promise<void> => ipcRenderer.invoke('window:command', name),
    isMaximized: (): Promise<unknown> => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChanged: (callback: (maximized: unknown) => void): (() => void) => {
      const listener = (_event: unknown, maximized: unknown) => callback(maximized);
      ipcRenderer.on('window:maximized', listener);
      return () => {
        ipcRenderer.removeListener('window:maximized', listener);
      };
    },
  },
});
