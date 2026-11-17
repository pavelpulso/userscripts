# userscripts

Personal Tampermonkey scripts. Install: open the raw `.user.js` link with Tampermonkey enabled; updates arrive automatically via `@updateURL`.

| Script | What it does |
|---|---|
| [gemini-skill-summary](https://raw.githubusercontent.com/pavelpulso/userscripts/main/gemini-skill-summary.user.js) | «Суть видео» button on YouTube watch page and on every video card (search, subscriptions, channel Videos, sidebar, home) → Gemini skill `@youtube-summary`. «Суть статьи» button on article pages (or Alt+Shift+S / Tampermonkey menu anywhere; selected text wins) → page text to `@text-summary`. |

## Gemini side notes

- Skills are picked through the `@` mention menu: `#at-mentions-v2-panel .at-mentions-v2-item`, matched by `.at-mentions-v2-item-title` text. Item `aria-label` is "slug, description", so don't match on it.
- Real activation = skill chip `<strong>@slug</strong>` in the editor; plain text `@slug` looks the same but doesn't activate the skill.
- Bump `@version` on every change, or Tampermonkey won't pick the update up.
