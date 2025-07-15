import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { hc } from 'hono/client';

type Env = {
  WEBHOOK_URL: string;
  BASE_URL: string;
};

type App = {
  Env: Env;
  Bindings: CloudflareBindings;
};

const Duration: Record<string, number> = {
  '10s': 10 * 1000,
  '2m': 2 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
};

const app = new Hono<App>()
  .post('/alarm', async (c) => {
    console.log('Called /alarm endpoint', new Date().toISOString());
    const body = await c.req.json();
    const url = body['webhook'] || c.env.WEBHOOK_URL;
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `Alarm triggered at ${new Date().toISOString()}`,
      }),
    });
    return c.json(r.json());
  })
  .get('/scheduler/:interval', async (c) => {
    const interval = c.req.param('interval') || '2m';

    const id = c.env.SCHEDULER?.idFromName(interval);
    const stub = c.env.SCHEDULER.get(id);
    const hasAlarm = await stub.hasAlarm();
    const scheduledTime = await stub.scheduledTime();
    return c.json({ hasAlarm, scheduledTime });
  })
  .post('/scheduler/:interval', async (c) => {
    const interval = c.req.param('interval') || '2m';

    const id = c.env.SCHEDULER?.idFromName(interval);
    const stub = c.env.SCHEDULER.get(id);
    const duration = Duration[interval];
    if (!duration) {
      return c.json({ error: 'Invalid interval' }, 400);
    }

    const initialized = await stub.initSchedule(duration);
    if (!initialized) {
      return c.json({ error: 'Scheduler already initialized' }, 400);
    } else {
      return c.json({
        message: `Scheduler initialized with interval ${interval}`,
      });
    }
  });

export class Scheduler extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async initSchedule(duration: number): Promise<boolean> {
    await this.ctx.storage.put('duration', duration);
    const alarm = await this.ctx.storage.getAlarm();
    console.log(
      `Current alarm: ${alarm ? new Date(alarm).toISOString() : 'none'}`,
    );
    await this.ctx.storage.setAlarm(Date.now() + duration);
    console.log(
      `Scheduler initialized with duration ${duration}ms, next alarm set for ${new Date(Date.now() + duration).toISOString()}`,
    );
    return true;
  }

  async hasAlarm(): Promise<boolean> {
    const alarm = await this.ctx.storage.getAlarm();
    return !!alarm && alarm > Date.now();
  }
  async scheduledTime(): Promise<number | null> {
    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm <= Date.now()) return null;
    return alarm;
  }

  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    const duration: number = (await this.ctx.storage.get('duration')) || 0;
    console.log(
      `Alarm invoked`,
      'now',
      new Date().toISOString(),
      'alarm info',
      JSON.stringify(alarmInfo),
      'duration',
      duration,
    );
    if (alarmInfo?.isRetry) return;
    if (duration <= 0) return;

    const alarm = await this.ctx.storage.getAlarm();
    console.log(
      `Current alarm: ${alarm ? new Date(alarm).toISOString() : 'none'}`,
    );

    const r = await app.request('/alarm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhook: this.env.WEBHOOK_URL,
      }),
    });
    console.log(`Webhook response: ${r.status} ${r.statusText}`);

    const next = Date.now() + duration;
    console.log(`Setting next alarm for ${new Date(next).toISOString()}`);
    await this.ctx.storage.setAlarm(next); // Set next alarm for the configured duration
  }
}

export default app;
