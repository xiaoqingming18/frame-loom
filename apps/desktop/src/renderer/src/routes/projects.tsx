import { createFileRoute } from '@tanstack/react-router';
import { FolderOpen } from 'lucide-react';

export const Route = createFileRoute('/projects')({ component: ProjectsPage });

function ProjectsPage() {
  return (
    <section className="flex min-h-full flex-col items-center justify-center p-12 text-center">
      <FolderOpen className="mb-5 size-10 text-muted-foreground" />
      <h1 className="text-xl font-medium">项目库</h1>
      <p className="mt-3 text-muted-foreground">还没有项目，项目管理功能即将开放。</p>
    </section>
  );
}
