import { describe, expect, it } from 'vitest';
import { requestNeedsJob } from './responseRouting';

describe('answering in the chat or making a job', () => {
  it.each([
    'Build me an exhaustive list of video game websites that have reviews for games on playbound.club.  Sort them by how big they are.  Let\'s try to get 10 sites if we can',
    'what happened today in the midterm elections?',
    'Compare the top five casino affiliate programs',
    'Find me ten sites that review indie games',
    'Research our biggest competitors and give me a table',
    'Who publishes Factorio?',
    'How much did we earn from ads last month?',
    'Which sites list every game we carry?',
    'Summarize what each company did this week',
    'What should I post on Bluesky?',
  ])('answers this in the chat: %s', (text) => {
    expect(requestNeedsJob(text)).toBe(false);
  });

  it.each([
    'Every day, earn one dofollow backlink for a Frugal Gambler page.',
    'Every Monday, collect new Steam releases with multiplayer support and add them to the PlayBound catalog.',
    'Research the game Factorio and add its details to the PlayBound catalog.',
    'Send me a weekly list of new casinos',
    'Every 3 days find new casinos',
    'Keep an eye on competitor pricing',
    'Let me know when a new casino launches',
    'Monitor our rankings for these keywords',
    'Do outreach to ten game sites about reviews',
    'Publish a post about our new game',
    'Make a job that finds review sites',
    'Set up a research job for this',
    'Do this as a job',
    'Find review sites and add them to our database',
    'Automatically check for new deals',
  ])('makes this a job: %s', (text) => {
    expect(requestNeedsJob(text)).toBe(true);
  });
});
