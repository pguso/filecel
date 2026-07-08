# Setup

## One-time setup

### Create an npm automation token (publish `@filecel/r2`)

1. Sign in to npm as the account/org that owns `@filecel/r2`.
2. Go to npm access tokens:
   - `https://www.npmjs.com/settings/<your-username>/tokens`
3. Click **Generate New Token**.
4. Choose **Automation** (recommended for CI).
5. Ensure the token has permission to **publish** `@filecel/r2`:
   - If `@filecel/r2` is under an org scope, make sure the token is created under the correct org/user and that your npm account has publish rights for that package.
6. Copy the token value (you won’t be able to see it again).

### Add `NPM_TOKEN` to GitHub Actions secrets

1. Open your GitHub repo.
2. Go to **Settings → Secrets and variables → Actions**.
3. Click **New repository secret**.
4. Name it **`NPM_TOKEN`**.
5. Paste the npm automation token and save.

