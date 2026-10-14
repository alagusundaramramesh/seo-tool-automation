<<<<<<< HEAD
# Yngo: website audit + auto-fix

A web app that audits websites like Chrome DevTools / Lighthouse, scores every page,
explains each problem with how to fix it, and **fixes your project automatically**.

Everything happens in the browser dashboard. You only run one command.

> Please read [CODING_GUIDELINES.md](CODING_GUIDELINES.md) before changing code.

## Start

You need **Node.js 20+** and **Google Chrome** installed.

```bash
npm install
npm start
```

Open **http://localhost:3000**. Click **Continue as guest** to start right away, or create an account.
A guest who creates an account (or logs in) later keeps the audits and fixes they made as a guest.

(`npm run dev` does the same but restarts the server when you change code.)

Settings are optional. To change them, copy `.env.example` to `.env` and edit it.

## Using the dashboard

### Audits page

1. Paste a website address, choose how many pages, click **Start audit**.
   Or pick **Project folder** and click **Browse…** to choose a folder on this computer (no typing paths):
   - a plain HTML site (a folder with `index.html`), or
   - a React / Vite / Next.js project. Yngo audits its build folder (`dist`, `build` or `out`), so run `npm run build` first.
     The folder picker tells you if the build is missing.
2. You go straight to the audit page. It shows the progress and then the report.
3. The report shows:
   - **Scores**: site score, performance, accessibility, best practices, SEO
   - **Every problem on every page**, with filters by page, category and severity, and a search box.
     Click a problem to see why it matters, how to fix it (with a code example) and where it is on the page.
   - **Fix these problems automatically**, **Audit again**, **Printable report** and **Download JSON** buttons

### Auto-fix page

1. Choose your project:
   - **Folder on this computer**: click **Browse…** and choose the folder
   - **Upload a .zip**: zip your project folder (without `node_modules`) and upload it
2. Optional: choose an audit, so only the problems from that audit are fixed.
3. Click **Check my project**. Yngo shows every change as a coloured diff. **Nothing is changed yet.**
4. Click **Apply**.
   - Folder: files are fixed and a backup is saved. **Undo** puts them back.
   - Zip: click **Download fixed project**.
5. HTML folders: click **Audit this folder now** to see the new scores.

On the sample site, auto-fix moved the site score from **90 to 95** and accessibility from **76 to 92**.

### What auto-fix fixes

| Problem | Plain HTML | React / Next.js |
|---|---|---|
| `<html>` without `lang` | ✅ | ✅ `app/layout.js` or `pages/_document.js` |
| Missing viewport / charset | ✅ | Next.js adds these itself |
| Missing `<title>` | ✅ from the `<h1>` · review | 📝 tells you to add `export const metadata` |
| Missing meta description | ✅ from the first paragraph · review | 📝 same as above |
| Missing og:title / og:description | ✅ | |
| Missing canonical link | ✅ when you give the live site address | |
| Image without `alt` | ✅ from the file name · review | ✅ `<img>` and `<Image>` · review |
| Image without width/height | ✅ reads the real image size | ✅ `<img>` with images in `public/` |
| Images below the first one not lazy-loaded | ✅ `loading="lazy"` | ✅ (`next/image` does it already) |
| `target="_blank"` without `rel="noopener"` | ✅ | ✅ `<a>` and `<Link>` |

**review** = Yngo guessed the text (for example alt="Brown leather wallet" from `brown-leather_wallet.jpg`). Please read it before publishing.
📝 = Yngo cannot fix it safely, so it tells you exactly what to add.

Auto-fix uses plain code rules: **no AI, no API keys, no tokens**.

### Try it with the samples

The project has two demo projects with mistakes on purpose:

- `sample-site/`: plain HTML. On the Audits page choose **Project folder** and browse to it.
- `sample-nextjs/`: Next.js files. On the Auto-fix page browse to it and click **Check my project**.

Tip: copy a sample folder first, so you can apply fixes to the copy.

## Local or online

The same app runs on your laptop or on a server. Only `.env` changes.

| Setting | On your computer | On a public server |
|---|---|---|
| `STORAGE_DRIVER` | `local` (files in `./storage`) | `s3` |
| `S3_BUCKET`, `S3_REGION`, AWS keys | not needed | required |
| `ALLOW_PRIVATE_URLS` | `true` (audit localhost) | **`false`** (nobody can scan your server's network) |
| `ALLOW_LOCAL_FOLDERS` | `true` (choose and fix folders on this computer) | **`false`** (users upload a .zip instead, and the folder picker is off) |
| `COOKIE_SECURE` | `false` | `true` (when using https) |
| `SESSION_SECRET` | leave empty | set a long random text |

There is no database to install. Users, audits and fixes are saved as small JSON files in storage (local disk or S3).

## How the code is organised

```
server.js                   Starts the web app (npm start)
public/                     The dashboard: plain HTML + JavaScript, no build step
  login.html, login.js         log in / create account / continue as guest
  index.html, dashboard.js     start audits (website or project folder), list audits
  audit.html, audit.js         one audit: progress, scores, full report with filters, "fix" button
  fix.html, fix.js             choose a project to fix, list fixes
  fix-result.html, fix-result.js   review changes, apply, undo, download
  common.js, style.css         shared helpers, top bar, folder picker, styles (light + dark)
src/
  config.js                 Settings from .env (all have defaults)
  auth.js                   Accounts, guest sessions, password hashing, login cookie
  routes/
    authRoutes.js           /api/auth   register, login, guest, logout, me
    auditRoutes.js          /api/audits start, list, view, report
    fixRoutes.js            /api/fixes  check, apply, undo, download
    folderRoutes.js         /api/folders  list folders for the folder picker
  auditJobs.js              Background audit queue (one at a time), finds the folder to serve for folder audits
  fixJobs.js                Auto-fix for folders and uploaded zips
  audit.js                  Audit flow: crawl -> Lighthouse + checks -> score -> save report
  crawler.js                Finds pages (sitemap.xml, links, robots.txt)
  lighthouse.js             Runs Lighthouse in Chrome, converts its result to our format
  checks.js                 Our own SEO checks
  suggestions.js            "How to fix" text for each problem
  scoring.js                Page score, site score, grades
  report.js                 HTML report
  storage.js                Save/read files on local disk or S3
  staticServer.js           Serves an HTML folder so it can be audited
  fixer/
    fixProject.js           Plan fixes, apply with backup, undo
    htmlFixes.js            Fix rules for .html files
    jsxFixes.js             Fix rules for React / Next.js files
    tagHelpers.js           Find and edit tags like <img> in file text
    localImages.js          Reads real image width/height
test/                       npm test
cli.js                      Optional terminal version of the same features (not needed for the web app)
```

### What is saved in storage

```
users/<userId>.json              one user (email + password hash, never the password)
users/guest-<random>.json        one guest session (no email, no password)
audits/<auditId>/audit.json      status and scores
audits/<auditId>/report.json     every issue found
audits/<auditId>/report.html     the report page
fixes/<fixId>/fix.json           changes + diffs shown on the review page
fixes/<fixId>/plan.json          original and fixed text of each file
fixes/<fixId>/upload.zip         uploaded project (zip only)
fixes/<fixId>/fixed.zip          fixed project to download (zip only)
settings/session-secret.txt      created on first start if SESSION_SECRET is empty
```

### Status flows

```
Audit:  queued -> running -> completed | failed
Fix:    planned -> applied -> undone          (undo only for folders)
```

If the server restarts during an audit, that audit is marked `failed` with a clear message.

### API

Every response has `"status": true`, or `"status": false` with a `code` and `message`.
All `/api/audits`, `/api/fixes` and `/api/folders` routes need a login (a guest session counts), and users only see their own data.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/register` | `{ email, password }` create account and log in |
| POST | `/api/auth/login` | `{ email, password }` |
| POST | `/api/auth/guest` | start a guest session (no account) |
| POST | `/api/auth/logout` | |
| GET | `/api/auth/me` | logged-in user and server settings |
| POST | `/api/audits` | `{ siteUrl, maxPages }` start a website audit |
| POST | `/api/audits/folder` | `{ folderPath }` audit a plain HTML folder or a built React / Next.js project |
| GET | `/api/audits` | your audits |
| GET | `/api/audits/:auditId` | one audit |
| GET | `/api/audits/:auditId/report.json` / `report.html` | the report |
| POST | `/api/fixes/folder` | `{ folderPath, auditId?, siteUrl? }` check a folder |
| POST | `/api/fixes/upload` | form: `projectZip`, `auditId?`, `siteUrl?` check a zip |
| GET | `/api/fixes` / `/api/fixes/:fixId` | your fixes / one fix with diffs |
| POST | `/api/fixes/:fixId/apply` | write the fixes |
| POST | `/api/fixes/:fixId/undo` | restore the backup (folders) |
| GET | `/api/fixes/:fixId/download` | fixed project (zips) |
| GET | `/api/folders?path=...` | folders inside a folder, and whether it is an auditable project (drives when `path` is empty) |

## Common tasks

**Add a new SEO check:** add an `if` block in `runPageChecks()` in `src/checks.js`, then add its "how to fix" entry in `src/suggestions.js` with the same `ruleId`.

**Add a new auto-fix:** copy a fix object in `src/fixer/htmlFixes.js` (or `jsxFixes.js`), set `fixesRuleIds`, add it to the list at the bottom, and add a test in `test/fixer.test.js`.

**Run the tests:** `npm test`

## Known limits

- Audits run one page at a time (a few seconds each), because parallel Lighthouse runs give unreliable scores.
- Lighthouse scores change a little between runs. That is normal.
- React apps that render only in the browser get fewer results from our extra SEO checks (Lighthouse still checks them fully).
- Folder audits of React projects use the last build, so run `npm run build` after changing code. Next.js apps that need a server: start them with `npm run dev` and audit the address (for example `http://localhost:3001`).
- Guest sessions last 7 days (the login cookie). Create an account to keep the audits longer.
- Only audit websites you own or have permission to test.

## What could come next

- Scheduled re-audits with email alerts when a score drops
- GitHub integration that opens a pull request with the fixes
- Team accounts and MongoDB, when there are many users
- Optional AI-written alt text and meta descriptions (opt-in with an API key)
=======
# seo-tool-automation
This project audit the site gives the lighthouse score then autofix local files if we gives apply.
>>>>>>> fd32e5fedd7e0bbdc5dd04d97f05ba6bde4dae6a
