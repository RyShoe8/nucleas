import { expect, it } from 'vitest';
import { readTokenUsage } from './tokenUsage';

it.each([
  [{ usage: null }, null, null],
  [{ usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 0 } }, 15, 0],
  [{ x_groq: { usage: { prompt_tokens: 7, completion_tokens: 11 } } }, 7, 11],
  [{ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 2 } }, 5, 5],
  [{ prompt_eval_count: 9, eval_count: 6 }, 9, 6],
  [{ usage: { total_tokens: 10 } }, null, null],
  [{ usage: { prompt_tokens: 7, total_tokens: 10 } }, 7, 3],
  [{ usage: { completion_tokens: 4, total_tokens: 10 } }, 6, 4],
  [{ usage: { prompt_tokens: 12, total_tokens: 10 } }, 12, null],
  [{ usage: { promptTokens: 8, completionTokens: 2 } }, 8, 2],
  [{ usage: { inputTokens: 8, outputTokens: 2 } }, 8, 2],
  [{ usage_metadata: { prompt_token_count: 5, candidates_token_count: 3 } }, 5, 3],
  [{ choices: [{ usage: { prompt_tokens: 3, completion_tokens: 1 } }] }, 3, 1],
  [{ response: { usage: { input_tokens: 9, output_tokens: 4 } } }, 9, 4],
  [{ meta: { billed_units: { input_tokens: 6, output_tokens: 2 } } }, 6, 2],
  [{ usage: { prompt_tokens: 0, completion_tokens: 3 } }, 0, 3],
])('reads counts from %j', (body, inputTokens, outputTokens) => {
  expect(readTokenUsage(body)).toEqual({ inputTokens, outputTokens });
});
