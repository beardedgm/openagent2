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
