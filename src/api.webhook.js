import { shopify, authenticateOffline } from 'meowapps'

// Process incoming Shopify webhooks.
export async function POST(req, res) {
  // Firebase parses JSON body but Shopify SDK expects raw buffer for HMAC verification
  if (req.rawBody) req.body = req.rawBody
  await shopify.processWebhooks({
    webhookHandlers: {
      APP_UNINSTALLED: { callback: handleAppUninstalled },
      APP_SCOPES_UPDATE: { callback: handleScopesUpdate },
      APP_SUBSCRIPTIONS_UPDATE: { callback: handleSubscriptionUpdate },
      CUSTOMERS_DATA_REQUEST: { callback: handleGdpr },
      CUSTOMERS_REDACT: { callback: handleGdpr },
      SHOP_REDACT: { callback: handleGdpr },
    },
  })(req, res)
}

// --- handlers --------------------------------------------------------------

// Delete all sessions for the uninstalled shop.
async function handleAppUninstalled(topic, shop) {
  console.log(`Received ${topic} webhook for ${shop}`)
  const storage = shopify.config.sessionStorage
  const sessions = await storage.findSessionsByShop(shop)
  await storage.deleteSessions(sessions.map(s => s.id))
}

// Update session scopes when merchant changes permissions.
async function handleScopesUpdate(topic, shop, body) {
  console.log(`Received ${topic} webhook for ${shop}`)
  const storage = shopify.config.sessionStorage
  const sessions = await storage.findSessionsByShop(shop)
  await Promise.all(sessions.map(s => {
    s.scope = body.current?.toString()
    return storage.storeSession(s)
  }))
}

// Sync $app:plan metafield when subscription status changes.
async function handleSubscriptionUpdate(topic, shop) {
  console.log(`Received ${topic} webhook for ${shop}`)
  try {
    const { billing } = await authenticateOffline(shop)
    await billing.check()
  } catch (err) {
    console.error(`Failed to sync plan for ${shop}:`, err.message)
  }
}

// GDPR mandatory compliance — app stores no customer data, acknowledge only.
async function handleGdpr(topic, shop) {
  console.log(`Received ${topic} webhook for ${shop}`)
}
