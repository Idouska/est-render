import crypto from 'crypto';

export interface WooOrder {
  id: number;
  number: string;
  status: string;
  total: string;
  currency: string;
  date_created: string;
  date_modified: string;
  customer_id: number;
  billing: WooAddress;
  shipping: WooAddress;
  line_items: WooLineItem[];
  payment_method_title: string;
}

export interface WooLineItem {
  id: number;
  name: string;
  quantity: number;
  price: number;
  sku: string;
  image?: { src: string };
}

export interface WooCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  billing: WooAddress;
  date_created: string;
  orders_count: number;
  total_spent: string;
}

export interface WooAddress {
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  address_1: string;
  address_2: string;
  city: string;
  state: string;
  postcode: string;
  country: string;
}

export class WooCommerceClient {
  private baseUrl: string;
  private consumerKey: string;
  private consumerSecret: string;

  constructor(storeUrl: string, consumerKey: string, consumerSecret: string) {
    this.baseUrl = storeUrl.replace(/\/$/, '') + '/wp-json/wc/v3';
    this.consumerKey = consumerKey;
    this.consumerSecret = consumerSecret;
  }

  private get authHeader(): string {
    const credentials = Buffer.from(
      `${this.consumerKey}:${this.consumerSecret}`
    ).toString('base64');
    return `Basic ${credentials}`;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader,
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`WooCommerce API ${res.status}: ${body}`);
    }

    return res.json();
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request('/system_status');
      return true;
    } catch {
      return false;
    }
  }

  async getOrders(perPage = 50, page = 1): Promise<WooOrder[]> {
    return this.request<WooOrder[]>(
      `/orders?per_page=${perPage}&page=${page}&orderby=date&order=desc`
    );
  }

  async getOrder(orderId: number): Promise<WooOrder> {
    return this.request<WooOrder>(`/orders/${orderId}`);
  }

  async getCustomers(perPage = 50, page = 1): Promise<WooCustomer[]> {
    return this.request<WooCustomer[]>(
      `/customers?per_page=${perPage}&page=${page}`
    );
  }

  async getCustomer(customerId: number): Promise<WooCustomer> {
    return this.request<WooCustomer>(`/customers/${customerId}`);
  }

  async getCustomerOrders(customerId: number): Promise<WooOrder[]> {
    return this.request<WooOrder[]>(`/orders?customer=${customerId}&per_page=20`);
  }

  async createWebhook(topic: string, deliveryUrl: string, secret: string): Promise<void> {
    await this.request('/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        name: `SAV Support – ${topic}`,
        topic,
        delivery_url: deliveryUrl,
        secret,
        status: 'active',
      }),
    });
  }

  async registerWebhooks(deliveryUrl: string, secret: string): Promise<void> {
    const topics = [
      'order.created',
      'order.updated',
      'customer.created',
      'customer.updated',
    ];

    await Promise.allSettled(
      topics.map((topic) => this.createWebhook(topic, deliveryUrl, secret))
    );
  }

  static verifyWebhookSignature(
    rawBody: string,
    signature: string,
    secret: string
  ): boolean {
    const hash = crypto
      .createHmac('sha256', secret)
      .update(rawBody, 'utf8')
      .digest('base64');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
  }
}
