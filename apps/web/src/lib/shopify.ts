import crypto from 'crypto';

export interface ShopifyOrder {
  id: number;
  order_number: number;
  name: string;
  email: string;
  financial_status: string;
  fulfillment_status: string | null;
  total_price: string;
  currency: string;
  line_items: ShopifyLineItem[];
  customer: ShopifyCustomerRef;
  shipping_address?: ShopifyAddress;
  billing_address?: ShopifyAddress;
  created_at: string;
  updated_at: string;
  order_status_url?: string;
}

export interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku: string;
  image?: { src: string };
}

export interface ShopifyCustomerRef {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
}

export interface ShopifyCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  orders_count: number;
  total_spent: string;
  created_at: string;
  updated_at: string;
}

export interface ShopifyAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  country: string;
  phone: string;
}

export interface ShopifyShop {
  id: number;
  name: string;
  email: string;
  domain: string;
  myshopify_domain: string;
  currency: string;
}

const SHOPIFY_API_VERSION = '2024-04';

export class ShopifyClient {
  private shopDomain: string;
  private accessToken: string;

  constructor(shopDomain: string, accessToken: string) {
    this.shopDomain = shopDomain;
    this.accessToken = accessToken;
  }

  private get baseUrl() {
    return `https://${this.shopDomain}/admin/api/${SHOPIFY_API_VERSION}`;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopify API ${res.status}: ${body}`);
    }

    return res.json();
  }

  async getShopInfo(): Promise<ShopifyShop> {
    const data = await this.request<{ shop: ShopifyShop }>('/shop.json');
    return data.shop;
  }

  async getOrders(limit = 50, sinceId?: string): Promise<ShopifyOrder[]> {
    const params = new URLSearchParams({ limit: String(limit), status: 'any' });
    if (sinceId) params.append('since_id', sinceId);
    const data = await this.request<{ orders: ShopifyOrder[] }>(`/orders.json?${params}`);
    return data.orders;
  }

  async getOrder(orderId: string | number): Promise<ShopifyOrder> {
    const data = await this.request<{ order: ShopifyOrder }>(`/orders/${orderId}.json`);
    return data.order;
  }

  async getCustomers(limit = 50): Promise<ShopifyCustomer[]> {
    const data = await this.request<{ customers: ShopifyCustomer[] }>(
      `/customers.json?limit=${limit}`
    );
    return data.customers;
  }

  async getCustomer(customerId: string | number): Promise<ShopifyCustomer> {
    const data = await this.request<{ customer: ShopifyCustomer }>(
      `/customers/${customerId}.json`
    );
    return data.customer;
  }

  async createWebhook(topic: string, address: string): Promise<void> {
    await this.request('/webhooks.json', {
      method: 'POST',
      body: JSON.stringify({ webhook: { topic, address, format: 'json' } }),
    });
  }

  async registerWebhooks(baseUrl: string): Promise<void> {
    const topics = [
      'orders/create',
      'orders/updated',
      'orders/cancelled',
      'customers/create',
      'customers/update',
    ];

    await Promise.allSettled(
      topics.map((topic) =>
        this.createWebhook(topic, `${baseUrl}/api/webhooks/shopify`)
      )
    );
  }

  static getOAuthUrl(
    shopDomain: string,
    clientId: string,
    redirectUri: string,
    state: string
  ): string {
    const scopes = 'read_orders,read_customers,read_products,write_script_tags';
    return (
      `https://${shopDomain}/admin/oauth/authorize` +
      `?client_id=${clientId}` +
      `&scope=${scopes}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`
    );
  }

  static async exchangeCodeForToken(
    shopDomain: string,
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<string> {
    const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });

    if (!res.ok) throw new Error('Failed to exchange Shopify OAuth code');
    const data = await res.json();
    return data.access_token as string;
  }

  static verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret: string
  ): boolean {
    const hash = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }
}
