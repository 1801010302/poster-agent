# Project UI contract

## Customer deployment handoff

When this source is being deployed for a new customer, read `AGENT_DEPLOY.md` and
`CUSTOMER_CONFIGURATION.md` before running any platform command. Create a new
EdgeSpark project from this source template; never reuse another owner's
`project_id`, domain, database, storage, vars, or secrets.

Run EdgeSpark commands for the user. If `edgespark login` or
`edgespark secret set` returns a browser URL, give that URL to the human owner
and pause only for the required browser action. Never ask the human to paste a
secret into chat, a source file, `.env`, a terminal transcript, or an Agent
prompt.

Before creating or changing any user-facing page or component:

1. Read `design-system/朋友圈海报智能体/MASTER.md`.
2. Check `design-system/朋友圈海报智能体/pages/<route-name>.md` for a documented override.
3. Use semantic values from `design-system/朋友圈海报智能体/tokens.css` or `tokens.json`; do not hardcode page-level colors, spacing or radii.
4. Preserve the selected violet-lime-orange-on-warm-white visual direction and its 60/25/10/5 color balance.
5. Keep one primary CTA per screen and never introduce a canvas/layer editor or a background-plus-text composition workflow.

If a requested page genuinely needs a visual exception, document the reason and replacement rule in a page override before implementing it.
