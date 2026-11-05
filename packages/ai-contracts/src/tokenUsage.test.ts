import { expect, it } from 'vitest';
import { readTokenUsage } from './tokenUsage';

it.each([
  [{ usage: null }, null, null],
  [{ usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 0 } }, 15, 0],
  [{ x_groq: { usage: { prompt_tokens: 7, completion_tokens: 11 } } }, 7, 11],
  [{ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 2 } }, 5, 5],
  [{ prompt_eval_count: 9, eval_count: 6 }, 9, 6],
  [{ usage: { total_tokens: 10 } }, null, null],
])('reads counts from %j', (body, inputTokens, outputTokens) => {
  expect(readTokenUsage(body)).toEqual({ inputTokens, outputTokens });
});
