import type { ProjectProfile } from '@frame-loom/contracts';
export const emptyProfile = (): ProjectProfile => ({
  form: null,
  medium: null,
  genres: [],
  aspect: null,
});
