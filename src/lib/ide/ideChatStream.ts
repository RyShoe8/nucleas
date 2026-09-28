/** Pipeline stage reported to the IDE office diorama. */
export type IdeChatStage = 'planner' | 'worker' | 'reviewer' | 'direct';

export type IdeChatStageStatus = 'start' | 'end';

export type IdeChatStageCallback = (stage: IdeChatStage, status: IdeChatStageStatus) => void;

export type IdeChatStreamStageEvent = {
  type: 'stage';
  stage: IdeChatStage;
  status: IdeChatStageStatus;
};

export type IdeChatStreamTurnEvent = {
  type: 'turn';
  turn: Record<string, unknown>;
  mode: string;
  modelProfileId?: string;
  model?: string;
  rulesApplied?: number;
  freeChat?: boolean;
  historyPersisted?: boolean;
};

export type IdeChatStreamErrorEvent = {
  type: 'error';
  error: string;
};

export type IdeChatStreamEvent =
  | IdeChatStreamStageEvent
  | IdeChatStreamTurnEvent
  | IdeChatStreamErrorEvent;

export function encodeIdeChatNdjsonLine(event: IdeChatStreamEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export async function withStage<T>(
  onStage: IdeChatStageCallback | undefined,
  stage: IdeChatStage,
  work: () => Promise<T>
): Promise<T> {
  onStage?.(stage, 'start');
  try {
    return await work();
  } finally {
    onStage?.(stage, 'end');
  }
}
