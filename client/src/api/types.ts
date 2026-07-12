export type Role = 'broker' | 'officeAdmin' | 'agent' | 'tc' | 'external';

export interface User {
  id: string;
  email: string;
  role: Role;
  officeId: string | null;
  status: 'active' | 'deactivated';
  displayName: string;
  phone: string;
  photoUrl: string;
  bio: string;
  emailPrefs: Record<string, boolean>;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Office {
  _id: string;
  name: string;
  address: string;
  timezone: string;
}

export interface Settings {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
  officeLocations: Office[];
  rssFeeds: string[];
  welcomeMessage: string;
  quickLinks: { label: string; url: string }[];
  homepageLayout: string[];
  reservableResources: ReservableResource[];
  onboardingTaskTemplateId: string | null;
  notificationDefaults: Record<string, boolean>;
}

export interface PublicSettings {
  brandName: string;
  logoUrl: string;
  primaryColor: string;
}

export interface Invitation {
  id: string;
  email: string;
  role: Role;
  officeId: string | null;
  expiresAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  link: string;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
}

export interface PostAuthor {
  id: string;
  displayName: string;
  photoUrl: string;
}

export interface Post {
  id: string;
  title: string;
  bodyHtml: string;
  excerpt: string;
  author: PostAuthor | null;
  officeId: string | null;
  important: boolean;
  commentsEnabled: boolean;
  pinnedAt: string | null;
  publishAt: string;
  createdAt: string;
}

export interface PostComment {
  id: string;
  body: string;
  author: PostAuthor | null;
  createdAt: string;
}

export interface FeedItem {
  id: string;
  kind: 'internal' | 'external';
  title: string;
  link: string;
  source?: string;
  pinnedUntil?: string | null;
  date: string;
}

export interface FeedResponse {
  pinned: FeedItem[];
  items: FeedItem[];
  nextCursor: string | null;
}

export type RsvpResponse = 'yes' | 'no' | 'maybe';
export type EventRecurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type TaskPriority = 'High' | 'Medium' | 'Low';

export interface CalendarEventInfo {
  id: string;
  title: string;
  descriptionHtml: string;
  kind: 'office' | 'personal';
  createdBy: string;
  officeId: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  recurrence: EventRecurrence;
  recurrenceUntil: string | null;
  rsvpEnabled: boolean;
  mandatory: boolean;
  resourceId: string | null;
  myRsvp: RsvpResponse | null;
  createdAt: string;
}

export interface EventOccurrence {
  event: CalendarEventInfo;
  startAt: string;
  endAt: string;
}

export interface RsvpSummary {
  yes: string[];
  no: string[];
  maybe: string[];
}

export interface TaskAttachmentInfo {
  name: string;
  size: number;
  contentType: string;
}

export interface TaskInfo {
  id: string;
  title: string;
  descriptionHtml: string;
  createdBy: string;
  priority: TaskPriority;
  dueAt: string | null;
  attachments: TaskAttachmentInfo[];
  recurrence: EventRecurrence;
  isOnboarding: boolean;
  myCompletion: { completedAt: string | null; note: string } | null;
  counts: { total: number; completed: number };
  relatedResourceId: string | null;
  createdAt: string;
}

export interface TaskMatrixRow {
  userId: string;
  displayName: string;
  completedAt: string | null;
  note: string;
}

export interface TaskTemplateInfo {
  id: string;
  name: string;
  items: { title: string; descriptionHtml: string; priority: TaskPriority; dueInDays: number | null }[];
  createdAt: string;
}

export interface OnboardingProgress {
  total: number;
  completed: number;
}

export interface ReservableResource {
  _id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  parentId: string | null;
}

export interface ResourceVersion {
  name: string;
  size: number;
  contentType: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface ResourceInfo {
  id: string;
  title: string;
  description: string;
  kind: 'file' | 'link';
  externalUrl: string;
  fileType: string;
  categoryId: string;
  subcategoryId: string | null;
  uploadedBy: string;
  officeId: string | null;
  featured: boolean;
  currentFile: { name: string; size: number; contentType: string } | null;
  bookmarked: boolean;
  versions?: ResourceVersion[]; // present for officeAdmin+ only
  createdAt: string;
  updatedAt: string;
}

export interface BannerInfo {
  id: string;
  kind: 'image' | 'text';
  title: string;
  imageUrl: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  officeId: string | null;
  startAt: string;
  endAt: string;
  clickCount: number;
  createdAt: string;
}
