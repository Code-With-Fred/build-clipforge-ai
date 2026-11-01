import { integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: timestamp('emailVerified'),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId').notNull(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId').notNull(),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const project = pgTable('project', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'),
  duration: integer('duration').notNull().default(0),
  sourcePathname: text('sourcePathname'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const upload = pgTable('upload', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  projectId: text('projectId'),
  pathname: text('pathname').notNull(),
  filename: text('filename').notNull(),
  contentType: text('contentType').notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const clip = pgTable('clip', {
  id: text('id').primaryKey(),
  projectId: text('projectId').notNull(),
  userId: text('userId').notNull(),
  position: integer('position').notNull(),
  start: integer('start').notNull(),
  duration: integer('duration').notNull(),
  title: text('title').notNull(),
  reason: text('reason').notNull().default(''),
  transformation: text('transformation').notNull(),
  url: text('url').notNull(),
  status: text('status').notNull().default('processing'),
  // YouTube-ready extras (added by ensureClipTable for existing databases).
  renderUrl: text('renderUrl'),
  hook: text('hook').notNull().default(''),
  description: text('description').notNull().default(''),
  hashtags: text('hashtags').notNull().default(''),
  captions: text('captions').notNull().default(''),
  finishing: text('finishing').notNull().default(''),
  detail: text('detail').notNull().default(''),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})
