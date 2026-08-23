import { Empty, Timeline, Typography } from 'antd';
import dayjs from 'dayjs';
import type { AuditEvent } from '@/domain/types';

export function BusinessTimeline({ events }: { events: readonly AuditEvent[] }) {
  if (events.length === 0) {
    return <Empty description="暂无流转记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  return (
    <Timeline
      items={events.map((event) => ({
        color: event.result === 'success' ? 'green' : 'red',
        content: (
          <div>
            <Typography.Text>{event.message}</Typography.Text>
            <br />
            <Typography.Text type="secondary">
              {dayjs(event.occurredAt).format('MM-DD HH:mm')} · {event.actor.name}
            </Typography.Text>
          </div>
        ),
      }))}
    />
  );
}
