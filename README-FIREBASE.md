# VIBEX — Google Login + Cloud History Setup (10 min, free, no card)

VIBEX already contains the full login + cloud-history code. You only need to
create a free Firebase project and paste its config. Nothing works without
this step — Firebase accounts must belong to *you*.

## Step 1 — Create the project

1. Go to https://console.firebase.google.com → **Create a project**
2. Name it `vibex` → Continue → turn OFF Google Analytics (optional) → Create.

## Step 2 — Enable Google login

1. Left menu → **Build → Authentication** → **Get started**.
2. **Sign-in method** tab → enable **Google** → pick your email as support address → Save.

## Step 3 — Create the database

1. Left menu → **Build → Firestore Database** → **Create database**.
2. Choose **production mode** → pick the closest location → Enable.
3. **Rules** tab → replace everything with this (users can only read/write
   their own history), then **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /history/{uid}/{rest=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

## Step 4 — Get your web config

1. Project **Overview** (gear icon → Project settings) → **Your apps** →
   click the **`</>`** (web) icon → register app nickname `vibex-web`.
2. Copy the `firebaseConfig` object. It looks like this:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "vibex-xxxxx.firebaseapp.com",
  projectId: "vibex-xxxxx",
  storageBucket: "vibex-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

## Step 5 — Paste it into VIBEX

Open `music-app/index.html`, find this line (search `FIREBASE_CONFIG`):

```js
const FIREBASE_CONFIG = null; // <-- paste your Firebase web config here
```

Replace `null` with your copied object:

```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  // ... your values
};
```

Refresh the app — the sidebar now shows **🔐 Login with Google**.

## Step 6 — Authorize your domain (important!)

Google login only works on domains you allow:

1. Firebase console → **Authentication → Settings → Authorized domains** →
   **Add domain**.
2. Add your Render domain (e.g. `vibex.onrender.com`).
   (For local testing, `localhost` already works.)

## What you get

- 🔐 Login with Google (avatar + name in the sidebar, logout anytime).
- ☁ Every played song is saved to **your private cloud history**
  (`history → your-user-id → plays` in Firestore).
- 📊 The **Stats page** shows a *"Recent plays (all devices)"* section when
  logged in — same history on phone + computer.
- 💾 Without login (or without config), everything still works exactly as
  before using on-device storage. Login only *adds* cloud sync.

## Cost

Firebase's free tier (Spark plan): 50k reads + 20k writes per day — enough for
thousands of song plays daily. No card required unless you upgrade.
