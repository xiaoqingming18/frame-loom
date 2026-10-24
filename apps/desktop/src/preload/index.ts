import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('frameLoom', {
  getEngineConnection: (): Promise<unknown> => ipcRenderer.invoke('engine:connection'),
});
