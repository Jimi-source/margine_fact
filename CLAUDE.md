# marginefact-api

Web service for calculating profit margins. Accepts Excel (.xlsx/.xls) and CSV files,
calculates margin/profitability and returns the result.

## Stack
- Node.js / Express (backend)
- PostgreSQL on VPS
- JWT auth (bcryptjs + jsonwebtoken)
- Email via Resend
- Telegram notifications
- Frontend: HTML/CSS/JavaScript

## Where things live
- VPS: /var/www/marginefact-api
- Process on VPS: PM2, name — marginefact-api
- Frontend: https://margine-fact.vercel.app (auto-deploys via Vercel)
- Backend: runs on VPS via PM2

## Deployment
On every push to main:
- Vercel automatically deploys the frontend
- GitHub Actions connects to VPS, runs git pull, npm install, pm2 restart marginefact-api

## Project structure
- index.js — backend code
- index.html — main page
- app.js — frontend logic
- styles.css — styles
- functions/ — helper functions
- data/ — data files

## Environment variables (in .env on VPS, not in repo)
- JWT_SECRET
- RESEND_API_KEY
- TELEGRAM_BOT_TOKEN
- DATABASE_URL or PostgreSQL connection params

---

## SKILL: Analyze Before Acting (zoom-out)
Before making ANY change:
1. Read ALL related files — not just the one being changed
2. Map dependencies: which JS uses this CSS/HTML, which API endpoint does this frontend call
3. Find conflicts:
   - CSS: overflow + position:sticky incompatibility, z-index stacking, display:flex/grid interactions
   - JS: event listeners, global variables, async state, shared functions
   - API: DB schema, existing endpoints, auth middleware
4. Only AFTER this analysis — propose a solution

---

## SKILL: Minimal Changes
- Change ONLY what is needed for the task — do not refactor along the way
- Do not add new dependencies unless absolutely necessary
- If you spot a nearby problem — report it, but do NOT fix it without being asked
- Principle: the smallest change that solves the problem

---

## SKILL: Do Not Break What Works
Before any change, verify:
- Will this break other tabs or sections of the app?
- Will this affect shared styles (.table-wrap, .card, .grid, etc.)?
- Will this interfere with auth or data processing?
- If the change is risky — warn the user and explain the risk clearly

---

## SKILL: Git Safety
- NEVER use git push --force
- NEVER delete branches without explicit request
- Only commit changed files, not everything
- Commit message should briefly describe what was done
- If something goes wrong — suggest reverting via git revert

---

## SKILL: Code Quality (Deep Modules)
- Best code: simple interface hiding complexity inside
- Do not duplicate logic — if the same thing appears in two places, extract it into a function
- Each function should do one thing and do it well
- Variable and function names should be self-explanatory
- Keep individual files reasonably small — split large files (>30KB) into logical modules

---

## Rules
- Do not touch the .env file — it only exists on VPS
- Do not commit node_modules or serviceAccount.json
- After changes, verify the server starts without errors
- Always respond in Russian
