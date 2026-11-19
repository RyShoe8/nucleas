# Office characters

Art for the team members in the Office (the main Nucleas window). Each team member can have one image per state:

| State | When it shows |
| --- | --- |
| `working` | A job or code change of theirs is running now |
| `waiting` | Something of theirs is waiting for you |
| `idle` | They have jobs, nothing is happening right now |
| `away` | No work assigned (shown faded) |

Team members: `marketing`, `engineering`, `design`, `creative`, `support`, `operations`.

1. Add files here named `<member>-<state>.gif` (PNG and WebP work too), for example `marketing-working.gif`.
2. List them in `src/components/os/modules/office/characters.ts` under `CHARACTER_ART`.

A member with only `idle` art uses it for every state. Members without art keep the built-in pixel placeholder.
Square images work best; they are shown at about 48×48 pixels, so draw at 96×96 or 144×144 with a transparent background.
Use only original art or art you have the rights to.
