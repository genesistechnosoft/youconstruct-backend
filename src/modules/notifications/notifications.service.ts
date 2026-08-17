import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { paginationMeta } from '../../common/utils/pagination.util';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly notificationsRepository: NotificationsRepository,
  ) {}

  async listNotifications(userId: string, page = 1, limit = 20) {
    const [notifications, total] = await Promise.all([
      this.notificationsRepository.findByUser(userId, page, limit),
      this.notificationsRepository.countByUser(userId),
    ]);

    return {
      message: 'Notifications fetched successfully',
      data: notifications,
      meta: paginationMeta(page, limit, total),
    };
  }

  async getUnreadCount(userId: string) {
    const count = await this.notificationsRepository.countUnread(userId);
    return { message: 'Unread count fetched', data: { count } };
  }

  async markRead(userId: string, id: string) {
    const notification = await this.notificationsRepository.findById(id);
    if (!notification) {
      throw new NotFoundException('Notification not found');
    }
    if (notification.userId !== userId) {
      throw new ForbiddenException('You do not own this notification');
    }
    if (notification.readAt) {
      return { message: 'Notification already read', data: notification };
    }

    const updated = await this.notificationsRepository.markRead(id);
    return { message: 'Notification marked as read', data: updated };
  }

  async markAllRead(userId: string) {
    await this.notificationsRepository.markAllRead(userId);
    return { message: 'All notifications marked as read', data: null };
  }
}
