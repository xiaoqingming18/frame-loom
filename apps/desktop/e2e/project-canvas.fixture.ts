import { expect, type ElectronApplication, type Page } from '@playwright/test';

/** 每个测试的数据目录内创建正式项目与创作页，重启时复用。 */
export async function openProjectCanvas(page: Page, app: ElectronApplication) {
  const location = await app.evaluate(({ app }) => app.getPath('userData'));
  const target = await page.evaluate(async (location) => {
    const { baseUrl, token } = await (
      window as unknown as {
        frameLoom: { getEngineConnection(): Promise<{ baseUrl: string; token: string }> };
      }
    ).frameLoom.getEngineConnection();
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(baseUrl + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<unknown>;
    };
    const projects = (await request('/projects')) as {
      id: string;
      name: string;
      rootPath: string;
    }[];
    const project =
      projects.find((item) => item.name === '验收项目') ??
      ((await request('/projects', { name: '验收项目', location })) as {
        id: string;
        rootPath: string;
      });
    const manifest = (await request(`/projects/${project.id}`)) as { pages: { id: string }[] };
    const page =
      manifest.pages[0] ??
      ((await request(`/projects/${project.id}/pages`, { name: '验收创作页' })) as { id: string });
    const result = {
      projectId: project.id,
      pageId: page.id,
      rootPath: project.rootPath,
      pagePath: `/projects/${project.id}/pages/${page.id}`,
    };
    sessionStorage.setItem('project-canvas-fixture', JSON.stringify(result));
    return result;
  }, location);
  await page.getByRole('link', { name: '项目库', exact: true }).first().click();
  await page.getByRole('link', { name: '打开项目 验收项目', exact: true }).click();
  await page.getByRole('heading', { name: '验收创作页', exact: true }).click();
  await expect(page.getByRole('region', { name: '画布编辑区' })).toBeVisible();
  return target;
}

export async function canvasFixture(page: Page) {
  return page.evaluate(
    () =>
      JSON.parse(sessionStorage.getItem('project-canvas-fixture')!) as {
        projectId: string;
        pageId: string;
        pagePath: string;
        rootPath: string;
      },
  );
}
