import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import {
  ProjectList,
  EpisodeListResult,
  ScriptResult,
  StoryResult,
  ProjectManifest,
  ProjectTag,
  ProjectTagCreateRequest,
  ProjectTagDeleteRequest,
  ProjectTagUpdateRequest,
  ProjectTagUsage,
  type ProjectTagDeleteRequest as ProjectTagDeleteRequestType,
  type ProjectSort,
  type ProjectSummary,
} from '@frame-loom/contracts';
import { getPreferences } from './desktop-bridge';
import type { EngineClient } from './engine-client';

export const episodesQuery = (client: EngineClient, id: string) =>
  queryOptions({
    queryKey: ['projects', id, 'episodes'],
    queryFn: ({ signal }) =>
      client.request(`/projects/${id}/episodes`, EpisodeListResult, { signal }),
  });
export const scriptQuery = (client: EngineClient, id: string, episodeId: string) =>
  queryOptions({
    queryKey: ['projects', id, 'episodes', episodeId, 'script'],
    gcTime: 0,
    queryFn: ({ signal }) =>
      client.request(`/projects/${id}/episodes/${episodeId}/script`, ScriptResult, { signal }),
  });
export const storyQuery = (client: EngineClient, id: string) =>
  queryOptions({
    queryKey: ['projects', id, 'story'],
    queryFn: ({ signal }) => client.request(`/projects/${id}/story`, StoryResult, { signal }),
  });

export const projectTagsQuery = (client: EngineClient, id: string) =>
  queryOptions({
    queryKey: ['projects', id, 'tags'],
    queryFn: ({ signal }) =>
      client.request(`/projects/${id}/tags`, z.array(ProjectTag), { signal }),
  });
export const projectTagUsagesQuery = (client: EngineClient, projectId: string, tagId: string) =>
  queryOptions({
    queryKey: ['projects', projectId, 'tags', tagId, 'usages'],
    queryFn: ({ signal }) =>
      client.request(`/projects/${projectId}/tags/${tagId}/usages`, ProjectTagUsage.array(), {
        signal,
      }),
  });
export const createProjectTag = (client: EngineClient, projectId: string, input: unknown) =>
  client.request(`/projects/${projectId}/tags`, z.array(ProjectTag), {
    method: 'POST',
    body: ProjectTagCreateRequest.parse(input),
  });
export const updateProjectTag = (
  client: EngineClient,
  projectId: string,
  tagId: string,
  patch: unknown,
) =>
  client.request(`/projects/${projectId}/tags/${tagId}`, z.array(ProjectTag), {
    method: 'PATCH',
    body: ProjectTagUpdateRequest.parse(patch),
  });
export const deleteProjectTag = (
  client: EngineClient,
  projectId: string,
  tagId: string,
  reassign: ProjectTagDeleteRequestType['reassign'],
) =>
  client.request(`/projects/${projectId}/tags/${tagId}/delete`, z.array(ProjectTag), {
    method: 'POST',
    body: ProjectTagDeleteRequest.parse({ reassign }),
  });

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
