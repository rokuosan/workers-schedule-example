import { Hono } from 'hono';

type Env = {
  WEBHOOK_URL: string;
}

type App = {
  Env: Env;
  Bindings: CloudflareBindings;
}

const app = new Hono<App>();

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

const handler: ExportedHandler<Env> = {
  fetch: app.fetch,
  scheduled: async (controller, env, ctx) => {
    const r = await fetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: `Scheduled event triggered!: \`${controller.cron}\``,
      }),
    })
    console.log(`Webhook response: ${r.status} ${r.statusText}`);
  }
}

export default handler;
