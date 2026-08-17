import { Injectable } from '@nestjs/common';
import { paginate } from '../../common/utils/pagination.util';
import { PrismaService } from '../../prisma/prisma.service';

const NOTIFICATION_SELECT = {
  id: true,
  userId: true,
  eventType: true,
  title: true,
  body: true,
  data: true,
  readAt: true,
  createdAt: true,
} as const;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUser(userId: string, page: number, limit: number) {
    const { skip, take } = paginate(page, limit);
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: NOTIFICATION_SELECT,
    });
  }

  countByUser(userId: string) {
    return this.prisma.notification.count({ where: { userId } });
  }

  countUnread(userId: string) {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  findById(id: string) {
    return this.prisma.notification.findUnique({
      where: { id },
      select: { id: true, userId: true, readAt: true },
    });
  }

  markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      select: NOTIFICATION_SELECT,
    });
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  create(data: {
    userId: string;
    eventType: string;
    title: string;
    body: string;
    data?: object | null;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        eventType: data.eventType as never,
        title: data.title,
        body: data.body,
        data: data.data ?? undefined,
      },
      select: { id: true },
    });
  }
}
