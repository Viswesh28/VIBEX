# Deploying VIBEX to Vercel

The live app is **https://vibex-music-pi.vercel.app** (project `vibex-music`,
team `VISWESH SARAVAN S's projects`).

This repository is a two-package monorepo (`music-app` + `jiosaavn-api`), which
is what the checked-in `vercel.json` describes. That configuration is exactly
what a normal Git-connected deploy would use.

## Why deploys are not triggered by Git

The `vibex-music` project currently has **Git auto-deploy disabled**
(`gitProviderOptions.createDeployments: "disabled"`) and its GitHub integration
is not linked as a login connection. Creating a deployment from a Git ref
therefore fails before the build starts:

```
readyState: ERROR
errorCode:  git_info_fail
reason:     Git information retrieval failed for this deployment.
```

A *file* deployment does not need that lookup, so it is the supported path
until the GitHub integration is re-connected (Vercel → Account → Login
Connections → GitHub).

## File deploy ("shim") recipe

Upload a tiny bundle whose `buildCommand` clones the repo and builds it. The
bundle itself contains no app code, so it never goes stale.

`vercel.json` in the bundle:

```json
{
  "installCommand": "true",
  "buildCommand": "rm -rf src && git clone --depth 1 --branch main https://github.com/Viswesh28/VIBEX.git src && cd src/jiosaavn-api && npm ci --omit=dev --ignore-scripts && cd ../music-app && npm ci --ignore-scripts && npm run build",
  "outputDirectory": "src/music-app/dist",
  "functions": {
    "api/[...path].mjs": { "maxDuration": 60 },
    "api/dl.mjs": { "maxDuration": 60 },
    "api/search/[path].mjs": { "maxDuration": 60 },
    "api/artists/[path].mjs": { "maxDuration": 60 },
    "api/songs/[path].mjs": { "maxDuration": 60 }
  },
  "rewrites": [{ "source": "/dl", "destination": "/api/dl" }],
  "headers": [
    {
      "source": "/sw.js",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=0, must-revalidate" },
        { "key": "Service-Worker-Allowed", "value": "/" }
      ]
    },
    {
      "source": "/manifest.webmanifest",
      "headers": [
        { "key": "Content-Type", "value": "application/manifest+json; charset=utf-8" },
        { "key": "Cache-Control", "value": "public, max-age=3600" }
      ]
    },
    {
      "source": "/icons/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800, immutable" }]
    },
    {
      "source": "/splash/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800, immutable" }]
    }
  ]
}
```

The other six files just forward `/api/*` into the cloned source, because
Vercel traces function imports from the deployed bundle and cannot see files
that only exist inside `src/` at build time:

| File | Contents |
|---|---|
| `package.json` | `{"name":"vibex-web","private":true,"version":"1.0.0"}` |
| `api/[...path].mjs` | `export { default } from '../src/api/[...path].mjs'` |
| `api/dl.mjs` | `export { default } from '../src/api/dl.mjs'` |
| `api/search/[path].mjs` | `export { default } from '../[...path].mjs'` |
| `api/artists/[path].mjs` | `export { default } from '../[...path].mjs'` |
| `api/songs/[path].mjs` | `export { default } from '../[...path].mjs'` |

Deployment request (`POST /v13/deployments`, or the Vercel connector's
`create_deployment`):

```jsonc
{
  "name": "vibex-music",
  "team_id": "team_6ogFAvUDUAJrBAfj1QiIxBwT",
  "target": "production",              // omit for a preview deployment
  // Each entry is a JSON *string*: {"file":"<path>","data":"<contents>"}
  "files": [ /* the seven files above, serialised */ ]
}
```

Two pitfalls that cost real time:

- `"target": "preview"` is rejected — omit `target` for previews, or use
  `"production"`.
- Git deployments need `git_source: {type: "github", repoId: 1380882457, ref:
  "main"}`, which fails with `git_info_fail` while the GitHub connection is
  broken. Do not use it as a retry strategy.
- Vercel restores the previous build's cache, which already contains
  `src/`. A bare `git clone src` then dies with `fatal: destination path
  'src' already exists` → `BUILD_UTILS_SPAWN_128`. Always lead with
  `rm -rf src`.

## Verifying a deploy

Deployment URLs (`vibex-music-<hash>-<team>.vercel.app`) sit behind Vercel
Authentication when `ssoProtection` is `all_except_custom_domains`. The
project's production domain is public, so check there:

```sh
BASE=https://vibex-music-pi.vercel.app

curl -sI  $BASE/manifest.webmanifest   # 200 + application/manifest+json
curl -s   $BASE/manifest.webmanifest   # 4 icons, display: standalone
curl -sI  $BASE/sw.js                  # 200 + Service-Worker-Allowed: /
curl -s   "$BASE/api/search/songs?query=arijit&limit=2"  # {"success":true,...}
curl -s   $BASE/offline.html           # the offline shell
curl -sI  $BASE/icons/apple-touch-icon.png  # 200 + image/png
curl -sI  $BASE/splash/1290x2796.png        # 200 + image/png
curl -s   "$BASE/dl"                   # {"success":false,...} → rewrite works
```

A successful build must report five lambdas and `Build Completed in
/vercel/output`. `list_deployment_files` only lists `src/` and the `out/api/*`
lambdas even for healthy deployments, so it is **not** a way to confirm the
static site was published — check the URL instead.

## After a deploy that changes PWA assets

iOS freezes Home Screen metadata (icon, launch screens, status bar style) at
install time. Delete the app from the Home Screen, clear the site's website
data in Safari settings if the old shell persists, then re-add it. See
[`MOBILE.md`](MOBILE.md) for the install steps and the Web Inspector
checklist.
