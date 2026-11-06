import { expect, it } from 'vitest';
import { plainPageText } from './browserClient';

it('reads text across links and formatting, as a person sees it', () => {
  expect(plainPageText('<p>We are <a href="/team">a team</a> of <strong>11</strong>&nbsp;people.</p>')).toBe('We are a team of 11 people.');
});

it('leaves out scripts and styles', () => {
  expect(plainPageText('<style>.a{color:red}</style><script>var x = "hidden";</script><p>Visible</p>')).toBe('Visible');
});

it('keeps an email address that only appears in a mailto link', () => {
  expect(plainPageText('<a href="mailto:hello@gila.com?subject=Hi">Email us</a>')).toContain('hello@gila.com');
});

it('reads common entities', () => {
  expect(plainPageText('<p>We&rsquo;re small &amp; independent</p>')).toBe("We're small & independent");
});
