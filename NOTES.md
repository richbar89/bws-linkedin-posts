# BWS LinkedIn Posts — Project Notes

## Key Commands

### Replit: Pull latest from GitHub
```
git stash -u && git pull origin main
```

### Replit: Deploy
Pull latest, then click **Deploy** in Replit UI.

---

## Secrets Required (Replit → Secrets)
| Key | Purpose |
|-----|---------|
| `ANTHROPIC_API_KEY` | Claude AI post generation |
| `DATABASE_URL` | PostgreSQL connection |
| `BUFFER_ACCESS_TOKEN` | Buffer scheduling API |

---

## Current Status — 31 March 2026

### What's built
- **Tender browser** — browses/filters tenders from the last 24 hours by sector
- **Post generation** — select tenders, generate LinkedIn posts via Claude (Sonnet 4.6)
- **LinkedIn Stager** — stage generated posts, edit titles, push to Google Sheets
- **Text Formatter** — bold/italic/emoji formatting tool for LinkedIn posts
- **Tender Scanner** — paste a tender URL + page content, AI generates a post instantly
- **Automated pipeline** — runs Mon–Fri at 6pm: fetch → score → generate → schedule to Buffer
  - Mon–Thu: schedules next day 7:30am–5:30pm
  - Friday: schedules Sat + Mon posts, generates Monday morning round-ups (Security / Construction / rotating 3rd industry)

### In progress
- **Buffer Queue dashboard** — view upcoming scheduled posts across all 3 LinkedIn channels (BWS Main, Security, Construction). Server endpoints done (`/api/buffer/queue`, `/api/buffer/post/:id`). UI nav + HTML + CSS added. JS not yet wired up.

### LinkedIn channels (Buffer)
| Key | Page | Buffer Channel ID |
|-----|------|-------------------|
| `main` | Bid Writing Service | `69b6b0007be9f8b1715b02ae` |
| `security` | BWS \| Security | `69b6b0007be9f8b1715b02b0` |
| `construction` | BWS \| Construction | `69b6b1527be9f8b1715b0875` |

---

## Deployment Notes
- Replit `[env]` section in `.replit` is **dev only** — deployment uses **Secrets** exclusively
- Root cause of past deployment failures: Replit's local `package.json` was an older version missing `@anthropic-ai/sdk` and `node-cron`. Fixed by Replit agent running `npm install`. Always pull from git before deploying to avoid this.
- **Always run `git stash -u && git pull origin main` before deploying**

## Recent Changes
| Date | Change |
|------|--------|
| 31 Mar 2026 | Removed Daily Brief feature (sidebar, CSS, JS, 5 server endpoints) |
| 31 Mar 2026 | Added Tender Scanner (URL + paste content → AI post → stage/push to sheets) |
| 31 Mar 2026 | Fixed Tender Scanner to use pasted page content (tender sites block server-side fetch) |
| 31 Mar 2026 | Set up GitHub repo (`richbar89/bws-linkedin-posts`) and Replit git sync |
| 31 Mar 2026 | Fixed deployment: removed duplicate port 3000, switched run command to `npm start` |
| 31 Mar 2026 | Committed missing files that were crashing deployment (agents/, generate-posts.js, etc.) |
| 31 Mar 2026 | Added Buffer Queue dashboard (server endpoints + UI shell — JS in progress) |
| 31 Mar 2026 | Deployment fixed — Replit local package.json was stale/missing deps; now synced via git |
