import { createFileRoute, Link } from '@tanstack/react-router';

export const Route = createFileRoute('/projects_/$projectId_/pages/$pageId')({
  component: PageRoute,
});
function PageRoute() {
  const { projectId } = Route.useParams();
  return (
    <section className="p-8">
      <h1 className="text-xl font-medium">创作页</h1>
      <p className="my-4 text-muted-foreground">创作页已保存，项目画布正在接入。</p>
      <Link to="/projects/$projectId" params={{ projectId }} search={{ tab: 'pages', path: '' }}>
        返回项目
      </Link>
    </section>
  );
}
