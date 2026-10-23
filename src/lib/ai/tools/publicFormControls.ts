/** Public control metadata only: never include input values, hidden fields or passwords. */
export function publicFormControls(html: string): { name: string; type: string; label: string }[] {
  const controls = [];
  const attr = (tag: string, name: string) => {
    const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
    return (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').slice(0, 150);
  };
  for (const match of html.matchAll(/<(input|select|textarea)\b[^>]*>/gi)) {
    const tag = match[0]; const type = attr(tag, 'type') || match[1].toLowerCase();
    if (['hidden', 'password'].includes(type.toLowerCase()) || /\bhidden(?:\s|>|=)/i.test(tag)) continue;
    const name = attr(tag, 'name') || attr(tag, 'id');
    const label = attr(tag, 'aria-label') || attr(tag, 'placeholder');
    if (name || label) controls.push({ name, type, label });
    if (controls.length >= 30) break;
  }
  return controls;
}
