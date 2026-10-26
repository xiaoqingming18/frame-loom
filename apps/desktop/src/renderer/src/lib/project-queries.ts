import { queryOptions } from '@tanstack/react-query';
import {
  ProjectList,
  ProjectManifest,
  type ProjectSort,
  type ProjectSummary,
} from '@frame-loom/contracts';
import { getPreferences } from './desktop-bridge';
import type { EngineClient } from './engine-client';

export const preferencesQuery = () =>
  queryOptions({ queryKey: ['preferences'], queryFn: getPreferences });
export const projectsQuery = (client: EngineClient) =>
  queryOptions({
    queryKey: ['projects', 'list'],
    queryFn: ({ signal }) => client.request('/projects', ProjectList, { signal }),
  });
export const projectQuery = (client: EngineClient, id: string) =>
  queryOptions({
    queryKey: ['projects', id],
    queryFn: ({ signal }) => client.request(`/projects/${id}`, ProjectManifest, { signal }),
  });
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
export function visibleProjects(projects: ProjectSummary[], sort: ProjectSort, search = '') {
  return projects
    .filter((project) =>
      project.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === 'name'
        ? collator.compare(a.name, b.name)
        : (sort === 'created'
            ? b.createdAt.localeCompare(a.createdAt)
            : b.updatedAt.localeCompare(a.updatedAt)) || collator.compare(a.name, b.name),
    );
}
