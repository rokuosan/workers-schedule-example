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

const app = new Hono<App>().post('/alarm', async (c) => {
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
});

const client = hc<typeof app>('/');

export class Scheduler extends DurableObject<Env> {
  storage: DurableObjectStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = ctx.storage;
  }

  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    if (alarmInfo?.isRetry) return;

    console.log(`Alarm triggered at ${new Date().toISOString()}`);
    const alarm = await this.storage.getAlarm({ allowConcurrency: false });
    console.log(
      `Current alarm: ${alarm ? new Date(alarm).toISOString() : 'none'}`,
    );

    const r = await client.alarm.$post();
    console.log(`Webhook response: ${r.status} ${r.statusText}`);

    this.storage.setAlarm(Date.now() + 2 * 60 * 1000); // Set next alarm for 2 minutes later
  }
}

export default app;
