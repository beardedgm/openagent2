import mongoose from 'mongoose';

const officeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: { type: String, default: '' },
  timezone: { type: String, default: 'America/Chicago' },
});

// Calendar events reference these subdoc _ids; clients must echo _id back on edit or references dangle. Deletion policy: resources are removable — conflict checks only guard live events (see calendarService).
const reservableResourceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
});

const quickLinkSchema = new mongoose.Schema({ label: String, url: String }, { _id: false });

const settingsSchema = new mongoose.Schema(
  {
    brandName: { type: String, default: 'My Brokerage' },
    logoUrl: { type: String, default: '' },
    primaryColor: { type: String, default: '#1d4ed8', match: /^#[0-9a-fA-F]{6}$/ },
    officeLocations: { type: [officeSchema], default: [] },
    reservableResources: { type: [reservableResourceSchema], default: [] },
    rssFeeds: { type: [String], default: [], validate: [(v: string[]) => v.length <= 10, 'Max 10 RSS feeds'] },
    welcomeMessage: { type: String, default: '' },
    quickLinks: { type: [quickLinkSchema], default: [] },
    homepageLayout: {
      type: [String],
      default: ['welcome', 'banners', 'announcements', 'myTasks', 'events', 'feed', 'quickLinks'],
    },
    onboardingTaskTemplateId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

export const Settings = mongoose.model('Settings', settingsSchema);
export type SettingsDoc = InstanceType<typeof Settings>;

export async function getSettings(): Promise<SettingsDoc> {
  return (await Settings.findOne()) ?? (await Settings.create({}));
}
