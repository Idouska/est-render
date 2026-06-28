import { sqliteTable, text, integer, real, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { randomUUID } from 'crypto';

// ─── Helpers ────────────────────────────────────────────────────────────────
const id = () => text('id').primaryKey().$defaultFn(() => randomUUID());
const now = () => text('created_at').notNull().$defaultFn(() => new Date().toISOString());
const nowUp = () => text('updated_at').notNull().$defaultFn(() => new Date().toISOString());

// ─── Tenants ────────────────────────────────────────────────────────────────
export const tenants = sqliteTable('tenants', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').notNull().default('FREE'),
  createdAt: now(),
  updatedAt: nowUp(),
});

// ─── Users ──────────────────────────────────────────────────────────────────
export const users = sqliteTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  password: text('password').notNull(),
  role: text('role').notNull().default('AGENT'),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: now(),
  updatedAt: nowUp(),
});

// ─── Customers ───────────────────────────────────────────────────────────────
export const customers = sqliteTable('customers', {
  id: id(),
  email: text('email').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  platform: text('platform'),
  createdAt: now(),
  updatedAt: nowUp(),
}, (t) => ({
  tenantEmailUnique: uniqueIndex('customers_tenant_email').on(t.tenantId, t.email),
  tenantIdx: index('customers_tenant_idx').on(t.tenantId),
}));

// ─── Orders ──────────────────────────────────────────────────────────────────
export const orders = sqliteTable('orders', {
  id: id(),
  externalId: text('external_id').notNull(),
  orderNumber: text('order_number').notNull(),
  status: text('status').notNull(),
  total: real('total').notNull().default(0),
  currency: text('currency').notNull().default('EUR'),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  platformUrl: text('platform_url'),
  createdAt: now(),
  updatedAt: nowUp(),
}, (t) => ({
  externalUnique: uniqueIndex('orders_external_unique').on(t.tenantId, t.externalId, t.platform),
  tenantIdx: index('orders_tenant_idx').on(t.tenantId),
  customerIdx: index('orders_customer_idx').on(t.customerId),
}));

// ─── Order Items ──────────────────────────────────────────────────────────────
export const orderItems = sqliteTable('order_items', {
  id: id(),
  orderId: text('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(1),
  price: real('price').notNull().default(0),
  imageUrl: text('image_url'),
});

// ─── Tickets ─────────────────────────────────────────────────────────────────
export const tickets = sqliteTable('tickets', {
  id: id(),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('OPEN'),
  priority: text('priority').notNull().default('NORMAL'),
  category: text('category'),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => customers.id),
  orderId: text('order_id').references(() => orders.id),
  agentId: text('agent_id').references(() => users.id),
  resolvedAt: text('resolved_at'),
  createdAt: now(),
  updatedAt: nowUp(),
}, (t) => ({
  tenantIdx: index('tickets_tenant_idx').on(t.tenantId),
  statusIdx: index('tickets_status_idx').on(t.status),
  customerIdx: index('tickets_customer_idx').on(t.customerId),
}));

// ─── Messages ────────────────────────────────────────────────────────────────
export const messages = sqliteTable('messages', {
  id: id(),
  content: text('content').notNull(),
  type: text('type').notNull().default('REPLY'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id),
  senderName: text('sender_name'),
  senderEmail: text('sender_email'),
  createdAt: now(),
}, (t) => ({
  ticketIdx: index('messages_ticket_idx').on(t.ticketId),
}));

// ─── Integrations ────────────────────────────────────────────────────────────
export const integrations = sqliteTable('integrations', {
  id: id(),
  platform: text('platform').notNull(),
  status: text('status').notNull().default('PENDING'),
  shopDomain: text('shop_domain'),
  storeUrl: text('store_url'),
  accessToken: text('access_token'),
  consumerKey: text('consumer_key'),
  consumerSecret: text('consumer_secret'),
  webhookSecret: text('webhook_secret'),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  lastSyncAt: text('last_sync_at'),
  syncedOrders: integer('synced_orders').notNull().default(0),
  syncedCustomers: integer('synced_customers').notNull().default(0),
  createdAt: now(),
  updatedAt: nowUp(),
}, (t) => ({
  tenantPlatformUnique: uniqueIndex('integrations_tenant_platform').on(t.tenantId, t.platform),
}));

// ─── Canned Responses ────────────────────────────────────────────────────────
export const cannedResponses = sqliteTable('canned_responses', {
  id: id(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category'),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: now(),
  updatedAt: nowUp(),
}, (t) => ({
  tenantIdx: index('canned_tenant_idx').on(t.tenantId),
}));

// ─── Tags ────────────────────────────────────────────────────────────────────
export const tags = sqliteTable('tags', {
  id: id(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  tenantId: text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
}, (t) => ({
  tenantNameUnique: uniqueIndex('tags_tenant_name').on(t.tenantId, t.name),
}));

// ─── Ticket Tags ──────────────────────────────────────────────────────────────
export const ticketTags = sqliteTable('ticket_tags', {
  ticketId: text('ticket_id').notNull().references(() => tickets.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
});

// ─── Relations ───────────────────────────────────────────────────────────────
export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  customers: many(customers),
  tickets: many(tickets),
  integrations: many(integrations),
  cannedResponses: many(cannedResponses),
  tags: many(tags),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  tenant: one(tenants, { fields: [users.tenantId], references: [tenants.id] }),
  assignedTickets: many(tickets, { relationName: 'agentTickets' }),
  messages: many(messages),
}));

export const customersRelations = relations(customers, ({ one, many }) => ({
  tenant: one(tenants, { fields: [customers.tenantId], references: [tenants.id] }),
  tickets: many(tickets),
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  tenant: one(tenants, { fields: [orders.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [orders.customerId], references: [customers.id] }),
  items: many(orderItems),
  tickets: many(tickets),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tickets.tenantId], references: [tenants.id] }),
  customer: one(customers, { fields: [tickets.customerId], references: [customers.id] }),
  order: one(orders, { fields: [tickets.orderId], references: [orders.id] }),
  agent: one(users, { fields: [tickets.agentId], references: [users.id], relationName: 'agentTickets' }),
  messages: many(messages),
  ticketTags: many(ticketTags),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  ticket: one(tickets, { fields: [messages.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [messages.authorId], references: [users.id] }),
}));

export const integrationsRelations = relations(integrations, ({ one }) => ({
  tenant: one(tenants, { fields: [integrations.tenantId], references: [tenants.id] }),
}));

export const cannedResponsesRelations = relations(cannedResponses, ({ one }) => ({
  tenant: one(tenants, { fields: [cannedResponses.tenantId], references: [tenants.id] }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tags.tenantId], references: [tenants.id] }),
  ticketTags: many(ticketTags),
}));

export const ticketTagsRelations = relations(ticketTags, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketTags.ticketId], references: [tickets.id] }),
  tag: one(tags, { fields: [ticketTags.tagId], references: [tags.id] }),
}));

// ─── Types ───────────────────────────────────────────────────────────────────
export type Tenant = typeof tenants.$inferSelect;
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Integration = typeof integrations.$inferSelect;
export type CannedResponse = typeof cannedResponses.$inferSelect;
