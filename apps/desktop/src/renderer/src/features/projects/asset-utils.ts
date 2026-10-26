export const assetUrl = (projectId: string, path: string) =>
  `frame-project://${projectId}/assets/${path.split('/').map(encodeURIComponent).join('/')}`;
export const assetQueryKey = (projectId: string) => ['projects', projectId, 'assets'];
export function canChooseDirectory(path: string, excluded?: string) {
  return !excluded || (path !== excluded && !path.startsWith(excluded + '/'));
}
