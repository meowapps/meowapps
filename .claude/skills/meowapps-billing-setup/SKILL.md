---
name: meowapps-billing-setup
description: Guide for adding Shopify billing (subscriptions, one-time purchases) to your app. Provides tested canonical code and Shopify billing knowledge.
---

## Step 1 — Understand the project

Read the user's `src/` directory listing and `shopify.app.toml`.
Check if `src/api.billing.js` or `src/api.webhook.js` already exists.

## Step 2 — Gather requirements

Ask the user:

1. **Plans**: What plans do you need? Provide name, price, interval (monthly/annual/one-time), and trial days for each. If unsure, offer to use placeholder plans they can customize later.
2. **Extension support**: Do checkout/theme extensions need to know the active plan? If yes, `$app:plan` metafield sync via `APP_SUBSCRIPTIONS_UPDATE` webhook will be included. (Default: yes)
3. **Billing UI**: Do you want a billing UI section? If yes, which page — existing or new `app.billing.jsx`?

If user provides plans via $ARGUMENTS, parse them and skip question 1.

## Step 3 — Plan

Present what will be created/modified and wait for approval:

- **Create** `src/api.billing.js` — standalone billing API route (always)
- **Copy + modify** `src/api.webhook.js` — only if extension support. This file lives in the meowapps package by default (`node_modules/meowapps/src/api.webhook.js`). User must copy it to `src/` to override (meowapps build: same basename in user's `src/` wins over package). Copy the entire file to preserve existing handlers, then add the billing webhook handler. If user already has `src/api.webhook.js`, read it and add the handler — do not overwrite.
- **Modify** `shopify.app.toml` — add `app_subscriptions/update` to existing webhook topics (if extension support). Verify first — add only if missing.
- **Create/Modify** billing UI page (if requested)

List the exact plan config that will be used. Wait for approval.

## Step 4 — Generate

Read `reference.md` from the same directory as this SKILL.md file for canonical tested code. Use it as the source of truth.

Rules:
- Copy the reference code structure exactly — only change the `plans` config to match user requirements. Remove plan keys the user didn't request (e.g. remove `oneTime` if they only want subscriptions)
- If no extension support: remove `export { checkBilling }`, the `checkBilling` function, and `authenticateOffline` from the import. Only import `{ authenticate }`
- `api.billing.js` is standalone. It imports from `'meowapps'` only
- For webhook: read the package's file first via `node_modules/meowapps/src/api.webhook.js`, copy to user's `src/api.webhook.js`, then add `checkBilling` import from `'./api.billing.js'` and `APP_SUBSCRIPTIONS_UPDATE` handler
- If user already has `src/api.webhook.js`, check if `APP_SUBSCRIPTIONS_UPDATE` already exists — add only if missing
- `shopify.app.toml`: append `app_subscriptions/update` to the existing topics array — do not replace other topics
- Never mention or modify `src/lib/shopify.js` — that is internal to the meowapps package
- Follow all meowapps coding style rules from the system prompt

## Step 5 — Verify

After generating, confirm:
- [ ] `src/api.billing.js` exists with correct plans config
- [ ] `src/api.billing.js` imports only from `'meowapps'`, no other local imports
- [ ] If extension support: `src/api.webhook.js` exists in user's `src/` with all original handlers preserved (APP_UNINSTALLED, APP_SCOPES_UPDATE, GDPR) plus APP_SUBSCRIPTIONS_UPDATE added
- [ ] If extension support: `shopify.app.toml` has `app_subscriptions/update` in webhook topics
- [ ] Frontend calls `POST /api/billing` with `{ action: 'check' }`, `{ action: 'cancel', id }`, or `{ interval: 'monthly' }` (subscribe has no action field — falls through to require)
- [ ] No billing code references `src/lib/shopify.js`

## Key knowledge

- Shopify has NO API for extensions to query billing — `$app:plan` metafield (namespace `$app`, key `plan`) is the ONLY way to pass plan state to checkout/theme extensions.
- `check()` always syncs this metafield: sets it to the active subscription name, or deletes it if no subscription. This is built into the billing module.
- `APP_SUBSCRIPTIONS_UPDATE` webhook triggers `checkBilling` to keep the metafield in sync when subscription changes outside the app (e.g. merchant cancels from Shopify admin).
- `authenticateOffline(shop)` creates a GraphQL client from stored offline session. Used by `checkBilling` because webhooks only provide a shop domain, not an authenticated HTTP request.
- `devStore` detection auto-enables `test: true` on partner development stores so billing works in dev without real charges.
- One-time purchases cannot be cancelled via API — only subscriptions can.
- Billing APIs do not require additional OAuth scopes. The `$app` metafield namespace is reserved for app-owned metafields.
- The `plans` object keys (e.g. `monthly`, `annual`, `oneTime`) are the `interval` values sent from the frontend: `{ interval: 'monthly' }` looks up `plans.monthly`.
- `$app:plan` metafield reflects active subscription name only. One-time purchases are checked separately via `requireOneTime` and are not synced to the metafield.
- Price currency is hardcoded to `'USD'`. Change `currencyCode` in `requireSubscription` and `requireOneTime` for other currencies.
- meowapps build: `node_modules/meowapps/src/` is scanned first, then user's `src/`. Same basename = user wins. This is why `api.webhook.js` must be copied to `src/` to override.

$ARGUMENTS
