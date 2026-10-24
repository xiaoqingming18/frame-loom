import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { RouterContext } from '@/app/router';

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: () => (
    <main role="alert">
      <h1>页面加载失败</h1>
      <p>请重新加载页面；若仍无法连接本地引擎，请重新启动应用。</p>
      <Link to="/">返回首页</Link>
    </main>
  ),
  notFoundComponent: () => (
    <main>
      <h1>页面不存在</h1>
      <Link to="/">返回首页</Link>
    </main>
  ),
});
