import { expect, it } from 'vitest';
import { publicFormControls } from './publicFormControls';
it('exposes actual URL controls while omitting tokens, passwords and existing values', () => {
  const controls = publicFormControls('<form><input type=hidden name=csrf value="secret-token"><input name="website" type="url" placeholder="Your website URL" value="private-value"><input name="password" type="password"><textarea name="description"></textarea></form>');
  expect(controls).toEqual([{ name: 'website', type: 'url', label: 'Your website URL' }, { name: 'description', type: 'textarea', label: '' }]);
  expect(JSON.stringify(controls)).not.toMatch(/secret-token|private-value|password/);
});
