import { z } from 'zod';

export const teamMessageRoleSchema = z.enum(['user', 'assistant', 'status']);
export type TeamMessageRole = z.infer<typeof teamMessageRoleSchema>;

export type TeamContextSummary = {
  projectName: string;
  inferenceReady: boolean;
  remoteEnabled: boolean;
  planningEnabled: boolean;
  unavailableReason: string | null;
  included: string[];
  recentObjectiveCount: number;
  recentRunCount: number;
};
