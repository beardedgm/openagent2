import { z } from 'zod';

export const updateSettingsSchema = z.object({
  brandName: z.string().min(1).max(100).optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a hex color like #1a2b3c').optional(),
  officeLocations: z
    .array(
      z.object({
        _id: z.string().optional(),
        name: z.string().min(1).max(100),
        address: z.string().max(300).default(''),
        timezone: z.string().min(1),
      }),
    )
    .max(50)
    .optional(),
  reservableResources: z
    .array(z.object({ _id: z.string().optional(), name: z.string().trim().min(1).max(80) }))
    .max(50)
    .optional(),
  onboardingTaskTemplateId: z.string().nullable().optional(),
  rssFeeds: z.array(z.string().url()).max(10).optional(),
  welcomeMessage: z.string().max(20000).optional(),
  quickLinks: z.array(z.object({ label: z.string().min(1).max(60), url: z.string().url() })).max(12).optional(),
});
