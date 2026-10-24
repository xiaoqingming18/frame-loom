export function getEngineConnection(): Promise<unknown> {
  return window.frameLoom.getEngineConnection();
}
