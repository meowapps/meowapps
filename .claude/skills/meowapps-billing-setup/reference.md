# Billing reference implementation

Canonical tested code. Use as-is — only change the `plans` config.

## src/api.billing.js

```js
import { authenticate, authenticateOffline } from 'meowapps'

export { checkBilling }

const BillingInterval = Object.freeze({
  Monthly: 'EVERY_30_DAYS',
  Annual: 'ANNUAL',
  OneTime: 'ONE_TIME',
})

const plans = {
  // --- CUSTOMIZE PLANS HERE ---
  monthly: { name: 'Demo Monthly', price: 5.00, interval: BillingInterval.Monthly, trialDays: 7 },
  annual: { name: 'Demo Annual', price: 50.00, interval: BillingInterval.Annual, trialDays: 7 },
  oneTime: { name: 'Demo Feature', price: 10.00, interval: BillingInterval.OneTime },
}

// Route billing actions: check status, cancel, or create subscription.
export async function POST(req, res) {
  const { action, interval, id } = req.body || {}
  const { session, graphql } = await authenticate(req, res)
  const billing = createBilling(session.shop, graphql)

  if (action === 'check') return res.json(await billing.check())
  if (action === 'cancel') return res.json(await billing.cancel(id))

  const plan = plans[interval]
  if (!plan) return res.status(400).json({ error: 'Invalid interval' })
  res.json(await billing.require(plan))
}

// Sync $app:plan metafield for a shop (used by webhook handler).
async function checkBilling(shop) {
  const { graphql } = await authenticateOffline(shop)
  const billing = createBilling(shop, graphql)
  await billing.check()
}

// --- billing ---------------------------------------------------------------

// Billing helpers scoped to a shop. Supports subscriptions and one-time purchases.
// check() syncs $app:plan metafield so checkout extensions can read the active plan.
function createBilling(shop, graphql) {
  const storeHandle = shop.replace('.myshopify.com', '')
  const url = (path) => `https://admin.shopify.com/store/${storeHandle}/apps/${process.env.SHOPIFY_API_KEY}${path}`
  let devStore = null

  return {
    // Query Shopify for active subscription and sync $app:plan metafield.
    async check() {
      const data = await graphql(`query { currentAppInstallation { activeSubscriptions {
        id name status test trialDays createdAt currentPeriodEnd
        lineItems { plan { pricingDetails {
          ... on AppRecurringPricing { price { amount currencyCode } interval }
        } } }
      } } shop { id plan { partnerDevelopment } metafield(namespace: "$app", key: "plan") { id value } } }`)

      devStore = data.shop?.plan?.partnerDevelopment ?? false

      const subs = data.currentAppInstallation?.activeSubscriptions || []
      const planMeta = data.shop?.metafield
      const planName = subs.length ? subs[0].name : null

      // Sync metafield to match billing state
      if (planName && planMeta?.value !== planName) {
        await graphql(`mutation ($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
        }`, { metafields: [{ namespace: '$app', key: 'plan', value: planName, type: 'single_line_text_field', ownerId: data.shop.id }] })
      } else if (!planName && planMeta) {
        await graphql(`mutation ($input: MetafieldDeleteInput!) {
          metafieldDelete(input: $input) { deletedId userErrors { field message } }
        }`, { input: { id: planMeta.id } })
      }

      if (!subs.length) return { active: false, plan: null }
      return { active: true, plan: planName, ...mapSubscription(subs[0]) }
    },

    // Ensure active billing exists. Auto-enables test mode on dev stores.
    async require({ name, price, interval = BillingInterval.Monthly, trialDays = 0, returnUrl = '/app' }) {
      if (devStore === null) await this.check()

      const test = devStore
      return interval === BillingInterval.OneTime
        ? requireOneTime(graphql, { name, price, test, returnUrl: url(returnUrl) })
        : requireSubscription(graphql, { name, price, interval, trialDays, test, returnUrl: url(returnUrl) })
    },

    // Cancel active subscription. One-time purchases cannot be cancelled via API.
    async cancel(id, { prorate = true } = {}) {
      if (!id.includes('AppSubscription')) return { status: 'CANCELLED' }

      const result = await graphql(`mutation ($id: ID!, $prorate: Boolean) {
        appSubscriptionCancel(id: $id, prorate: $prorate) {
          appSubscription { id status }
          userErrors { field message }
        }
      }`, { id, prorate })

      const { userErrors } = result.appSubscriptionCancel
      if (userErrors?.length) throw new Error(userErrors.map(e => e.message).join(', '))
      return { status: 'CANCELLED' }
    },
  }
}

// Map Shopify AppSubscription object to a flat record.
function mapSubscription(s) {
  const pricing = s.lineItems?.[0]?.plan?.pricingDetails
  return {
    type: 'subscription',
    id: s.id, name: s.name, status: s.status, test: s.test,
    trialDays: s.trialDays, createdAt: s.createdAt,
    currentPeriodEnd: s.currentPeriodEnd,
    price: parseFloat(pricing?.price?.amount || 0),
  }
}

// Create a new subscription.
async function requireSubscription(graphql, { name, price, interval, trialDays, test, returnUrl }) {
  const result = await graphql(`mutation ($name: String!, $returnUrl: URL!,
    $lineItems: [AppSubscriptionLineItemInput!]!, $trialDays: Int, $test: Boolean) {
    appSubscriptionCreate(name: $name, returnUrl: $returnUrl,
      lineItems: $lineItems, trialDays: $trialDays, test: $test) {
      confirmationUrl
      userErrors { field message }
    }
  }`, {
    name, trialDays, test, returnUrl,
    lineItems: [{
      plan: {
        appRecurringPricingDetails: {
          price: { amount: price, currencyCode: 'USD' },
          interval,
        }
      },
    }],
  })

  return extractConfirmation(result.appSubscriptionCreate)
}

// Query one-time purchases by name, or create a new one.
async function requireOneTime(graphql, { name, price, test, returnUrl }) {
  const data = await graphql(`query ($first: Int!) { currentAppInstallation {
    oneTimePurchases(first: $first, sortKey: CREATED_AT, reverse: true) {
      nodes { id name status test price { amount currencyCode } createdAt }
    }
  } }`, { first: 25 })
  const match = data.currentAppInstallation?.oneTimePurchases?.nodes
    ?.find(p => p.name === name && p.status === 'ACTIVE')

  if (match) {
    return {
      active: true, type: 'one_time',
      id: match.id, name: match.name, status: match.status, test: match.test,
      price: parseFloat(match.price?.amount || 0), createdAt: match.createdAt,
    }
  }

  const result = await graphql(`mutation ($name: String!, $price: MoneyInput!, $returnUrl: URL!, $test: Boolean) {
    appPurchaseOneTimeCreate(name: $name, price: $price, returnUrl: $returnUrl, test: $test) {
      confirmationUrl
      userErrors { field message }
    }
  }`, { name, test, returnUrl, price: { amount: price, currencyCode: 'USD' } })

  return extractConfirmation(result.appPurchaseOneTimeCreate)
}

// Extract confirmationUrl or throw on userErrors.
function extractConfirmation(payload) {
  if (payload.userErrors?.length) throw new Error(payload.userErrors.map(e => e.message).join(', '))
  return { active: false, confirmationUrl: payload.confirmationUrl }
}
```

## Webhook integration

Read `node_modules/meowapps/src/api.webhook.js` first, copy to user's `src/api.webhook.js`, then apply these 3 additions:

**1. Import** — add after existing imports:
```js
import { checkBilling } from './api.billing.js'
```

**2. Handler registration** — add to the `webhookHandlers` object:
```js
APP_SUBSCRIPTIONS_UPDATE: { callback: handleSubscriptionUpdate },
```

**3. Handler function** — add alongside other handler functions:
```js
// Sync $app:plan metafield when subscription status changes.
async function handleSubscriptionUpdate(topic, shop) {
  console.log(`Received ${topic} webhook for ${shop}`)
  try {
    await checkBilling(shop)
  } catch (err) {
    console.error(`Failed to sync plan for ${shop}:`, err.message)
  }
}
```

## shopify.app.toml

Add `app_subscriptions/update` to webhook topics:

```toml
[[webhooks.subscriptions]]
topics = [ "app/uninstalled", "app/scopes_update", "app_subscriptions/update" ]
```

## Frontend API contract

`POST /api/billing` accepts JSON body. UI implementation varies per project — use these endpoints and response shapes to build billing UI that fits the app's existing patterns.

### Endpoints

| Action | Request body | Response |
|--------|-------------|----------|
| Check status | `{ action: 'check' }` | `{ active: true, plan, type, id, name, status, test, trialDays, createdAt, currentPeriodEnd, price }` or `{ active: false, plan: null }` |
| Subscribe (recurring) | `{ interval: 'monthly' }` | `{ active: false, confirmationUrl }` — always redirects to Shopify payment page |
| Buy one-time | `{ interval: 'oneTime' }` | `{ active: false, confirmationUrl }` if not yet purchased, or `{ active: true, type: 'one_time', id, name, status, test, price, createdAt }` if already active |
| Cancel | `{ action: 'cancel', id }` | `{ status: 'CANCELLED' }` |

### Key behaviors

- `interval` value must match a key in the `plans` config (e.g. `'monthly'`, `'annual'`, `'oneTime'`)
- Subscribe returns `confirmationUrl` — redirect user to Shopify's payment page via `open(url, '_top')`
- After redirect, Shopify returns user to the `returnUrl` configured in the plan (default: `/app`)
- One-time purchases that are already ACTIVE return `{ active: true, ... }` instead of a new confirmation URL
- Call `check` on page load to show current billing state
