import { createFileRoute } from '@tanstack/react-router';
import { ProjectLibrary } from '@/features/projects/project-library';

export const Route = createFileRoute('/projects')({ component: ProjectLibrary });
