import mongoose from 'mongoose';

const rssItemSchema = new mongoose.Schema(
  {
    feedUrl: { type: String, required: true },
    guid: { type: String, required: true },
    title: { type: String, required: true },
    link: { type: String, default: '' },
    sourceTitle: { type: String, default: '' },
    publishedAt: { type: Date, required: true },
  },
  { timestamps: true },
);
rssItemSchema.index({ feedUrl: 1, guid: 1 }, { unique: true });
rssItemSchema.index({ publishedAt: -1 });

export const RssItem = mongoose.model('RssItem', rssItemSchema);
export type RssItemDoc = InstanceType<typeof RssItem>;
