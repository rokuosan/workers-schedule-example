import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';

export type Env = {
  WEBHOOK_URL: string;
  BASE_URL: string;
};

type App = {
  Env: Env;
  Bindings: CloudflareBindings;
};

const app = new Hono<App>();

app.get('/scheduler/:name', async (c) => {
  const name = c.req.param('name') || 'default';
  const id = c.env.SCHEDULER?.idFromName(name);
  if (!id) {
    return c.json({ error: 'Scheduler not found' }, 404);
  }
  const stub = c.env.SCHEDULER.get(id);
  const params = await stub.getParams();
  return c.json({
    name,
    interval: params.interval,
    message: params.message,
    nextScheduledTime: await stub.nextScheduledTime(),
  });
});

app.post('/scheduler/:name', async (c) => {
  const body = await c.req.json();
  const name = c.req.param('name') || 'default';
  const message = body.message || 'Hello, World!';
  const intervalSec = parseInt(body.interval) || 10;

  const id = c.env.SCHEDULER?.idFromName(name);
  const stub = c.env.SCHEDULER.get(id);
  const interval = intervalSec * 1000;

  const next = await stub.schedule(interval, message);
  if (next) {
    return c.json({
      message: `Scheduler for ${name} initialized with interval ${intervalSec}s`,
      nextAlarm: new Date(next).toISOString(),
    });
  }
  return c.json({ error: 'Failed to initialize scheduler' }, 500);
});

app.delete('/scheduler/:name', async (c) => {
  const name = c.req.param('name') || 'default';
  const id = c.env.SCHEDULER?.idFromName(name);
  if (!id) {
    return c.json({ error: 'Scheduler not found' }, 404);
  }
  const stub = c.env.SCHEDULER.get(id);
  await stub.delete();
  return c.json({ message: `Scheduler for ${name} cleared` });
});

export type SchedulerParams = {
  interval: number;
  message: string;
};

export class Scheduler extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async schedule(interval: number, message: string): Promise<number> {
    await this.ctx.storage.put('interval', interval);
    await this.ctx.storage.put('message', message);

    const alarm = await this.ctx.storage.getAlarm();
    if (alarm && alarm > Date.now()) {
      console.log(`Alarm already set for ${new Date(alarm).toISOString()}`);
      return alarm;
    }

    const next = Date.now() + interval;
    await this.ctx.storage.setAlarm(next);
    console.log(
      `Scheduler initialized with interval ${interval}ms, next alarm set for ${new Date(next).toISOString()}`,
    );
    return next;
  }

  async delete(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    console.log('Scheduler cleared');
  }

  async nextScheduledTime(): Promise<Date | null> {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm && alarm > Date.now()) {
      return new Date(alarm);
    }
    return null;
  }

  async getParams(): Promise<SchedulerParams> {
    const interval: number = (await this.ctx.storage.get('interval')) || 0;
    const message: string = (await this.ctx.storage.get('message')) || '';
    return { interval, message };
  }

  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    const interval: number = (await this.ctx.storage.get('interval')) || 0;
    const message: string = (await this.ctx.storage.get('message')) || '';

    // リトライでたくさん呼ばれると困るのでリトライは無視
    if (alarmInfo?.isRetry) return;
    if (interval <= 0) return;

    // Send the message to the webhook
    const r = await fetch(this.env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content: message }),
    });
    console.log(`Webhook response: ${r.status} ${r.statusText}`);

    // Reschedule the alarm
    await this.schedule(interval, message);
  }
}

export default app as ExportedHandler;
