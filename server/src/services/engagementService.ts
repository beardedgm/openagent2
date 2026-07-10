import { logger } from '../config/logger.js';
import { EngagementEvent, type EngagementType } from '../models/EngagementEvent.js';

export function logEngagement(type: EngagementType, userId: string, meta: Record<string, unknown> = {}): void {
  EngagementEvent.create({ type, userId, meta }).catch((err) => logger.error(err, 'engagement log failed'));
}
