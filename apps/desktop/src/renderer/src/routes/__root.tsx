import { createRootRouteWithContext, Link } from '@tanstack/react-router';
import type { RouterContext } from '@/app/router';
import { AppShell } from '@/app/shell/app-shell';
import { settingsSearch } from '@/app/shell/settings-search';

export const Route = createRootRouteWithContext<RouterContext>()({
  validateSearch: (search) => settingsSearch.parse(search),
  component: AppShell,
  errorComponent: () => (
    <div role="alert" className="p-12">
      <h1>页面加载失败</h1>
      <p>请重新加载页面；若仍无法连接本地引擎，请重新启动应用。</p>
      <Link to="/">返回首页</Link>
    </div>
  ),
  notFoundComponent: () => (
    <div className="p-12">
      <h1>页面不存在</h1>
      <Link to="/">返回首页</Link>
    </div>
  ),
});
