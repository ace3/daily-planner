export interface Project {
  id: string;
  name: string;
  path: string;
  prompt: string | null;
  created_at: string;
}

export interface CreateProjectInput {
  name: string;
  path: string;
}
