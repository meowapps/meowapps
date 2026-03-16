import { useState } from 'react'
import { authenticate } from 'meowapps'

export const meta = { title: 'Dashboard', description: 'Shopify app dashboard' }

export default function Index() {
  const [loading, setLoading] = useState(false)
  const [product, setProduct] = useState(null)
  const [variant, setVariant] = useState(null)

  return (
    <s-page heading="Shopify app template">
      <s-button slot="primary-action" onClick={generateProduct}>
        Generate a product
      </s-button>

      <s-section heading="Congrats on creating a new Shopify app">
        <s-paragraph>
          This embedded app template uses{' '}
          <s-link href="https://shopify.dev/docs/apps/tools/app-bridge" target="_blank">App Bridge</s-link>
          {' '}interface examples like an{' '}
          <s-link href="/app/additional">additional page in the app nav</s-link>
          , as well as an{' '}
          <s-link href="https://shopify.dev/docs/api/admin-graphql" target="_blank">Admin GraphQL</s-link>
          {' '}mutation demo, to provide a starting point for app development.
        </s-paragraph>
      </s-section>

      <s-section heading="Get started with products">
        <s-paragraph>
          Generate a product with GraphQL and get the JSON output for that product. Learn more about the{' '}
          <s-link href="https://shopify.dev/docs/api/admin-graphql/latest/mutations/productCreate" target="_blank">
            productCreate
          </s-link>{' '}
          mutation in our API references.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button onClick={generateProduct} {...(loading ? { loading: true } : {})}>
            Generate a product
          </s-button>
          {product && (
            <s-button
              onClick={() => shopify.intents.invoke?.('edit:shopify/Product', { value: product.id })}
              target="_blank"
              variant="tertiary"
            >
              Edit product
            </s-button>
          )}
        </s-stack>
        {product && (
          <s-section heading="productCreate mutation">
            <s-stack direction="block" gap="base">
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <pre style={{ margin: 0 }}><code>{JSON.stringify(product, null, 2)}</code></pre>
              </s-box>
              <s-heading>productVariantsBulkUpdate mutation</s-heading>
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <pre style={{ margin: 0 }}><code>{JSON.stringify(variant, null, 2)}</code></pre>
              </s-box>
            </s-stack>
          </s-section>
        )}
      </s-section>

      <s-section slot="aside" heading="App template specs">
        <s-paragraph><s-text>Platform: </s-text><s-link href="https://firebase.google.com/" target="_blank">Firebase</s-link></s-paragraph>
        <s-paragraph><s-text>Build: </s-text><s-link href="https://esbuild.github.io/" target="_blank">esbuild</s-link></s-paragraph>
        <s-paragraph><s-text>Server: </s-text><s-link href="https://expressjs.com/" target="_blank">Express</s-link></s-paragraph>
        <s-paragraph><s-text>Interface: </s-text><s-link href="https://shopify.dev/docs/api/app-home/using-polaris-components" target="_blank">Polaris web components</s-link></s-paragraph>
        <s-paragraph><s-text>API: </s-text><s-link href="https://shopify.dev/docs/api/admin-graphql" target="_blank">GraphQL</s-link></s-paragraph>
        <s-paragraph><s-text>Database: </s-text><s-link href="https://firebase.google.com/docs/firestore" target="_blank">Firestore</s-link></s-paragraph>
      </s-section>

      <s-section slot="aside" heading="Next steps">
        <s-unordered-list>
          <s-list-item>
            Explore Shopify's API with{' '}
            <s-link href="https://shopify.dev/docs/apps/tools/graphiql-admin-api" target="_blank">GraphiQL</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  )

  async function generateProduct() {
    setLoading(true)
    try {
      const data = await fetch('/app.rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'product' }),
      }).then(r => r.json())
      setProduct(data.product)
      setVariant(data.variant)
      shopify.toast.show('Product created')
    } finally {
      setLoading(false)
    }
  }

}

// --- rpc -------------------------------------------------------------------

// Create a demo product with a random color, then set its variant price to $100.
export async function POST(req, res) {
  const { graphql } = await authenticate(req, res)
  const color = ['Red', 'Orange', 'Yellow', 'Green'][Math.floor(Math.random() * 4)]

  const createData = await graphql(
    `mutation populateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id title handle status
          variants(first: 10) { edges { node { id price barcode createdAt } } }
        }
      }
    }`,
    { product: { title: `${color} Snowboard` } },
  )

  const product = createData.productCreate.product
  const variantId = product.variants.edges[0].node.id

  const variantData = await graphql(
    `mutation updateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price barcode createdAt }
      }
    }`,
    { productId: product.id, variants: [{ id: variantId, price: '100.00' }] },
  )

  res.json({
    product,
    variant: variantData.productVariantsBulkUpdate.productVariants,
  })
}

