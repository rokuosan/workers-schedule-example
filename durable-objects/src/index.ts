import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { hc } from 'hono/client';

type Env = {
  WEBHOOK_URL: string;
};

type App = {
  Env: Env;
  Bindings: CloudflareBindings;
};

const Duration: Record<string, number> = {
  '2m': 2 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
};

const app = new Hono<App>()
  .post('/alarm', async (c) => {
    const r = await fetch(c.env.WEBHOOK_URL, {
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
  .post('/scheduler/:interval', async (c) => {
    const interval = c.req.param('interval') || '2m';

    const id = c.env.SCHEDULER?.idFromName(interval);
    const stub = c.env.SCHEDULER.get(id);
    await stub.initSchedule(Duration[interval]);
    return c.text('Scheduler is running!');
  });

const client = hc<typeof app>('/');

export class Scheduler extends DurableObject<Env> {
  private storage: DurableObjectStorage;
  private duration: number = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
  }

  async initSchedule(duration: number): Promise<void> {
    this.duration = duration;
    const alarm = await this.storage.getAlarm({ allowConcurrency: false });
    if (!alarm) {
      this.storage.setAlarm(Date.now() + duration);
    }
  }

  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    if (alarmInfo?.isRetry) return;
    if (this.duration <= 0) return;

    console.log(`Alarm triggered at ${new Date().toISOString()}`);
    const alarm = await this.storage.getAlarm({ allowConcurrency: false });
    console.log(
      `Current alarm: ${alarm ? new Date(alarm).toISOString() : 'none'}`,
    );

    const r = await client.alarm.$post();
    console.log(`Webhook response: ${r.status} ${r.statusText}`);

    this.storage.setAlarm(Date.now() + this.duration); // Set next alarm for the configured duration
  }
}

export default app;
