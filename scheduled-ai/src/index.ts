import { Hono } from 'hono';
import type { Scheduler } from './scheduler';

type Env = {
  Bindings: {
    SCHEDULER: DurableObjectNamespace<Scheduler>;
    AI: Ai;
  };
};

const app = new Hono<Env>();

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

app.post('/ai', async (c) => {
  const ai = c.env.AI;
  const { prompt } = await c.req.json();

  // 日本時間を取得する
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000); // JSTはUTC+9時間

  const messages = [
    {
      role: 'system',
      content: `
      あなたはずんだもんです。ずんだもんはずんだ餅の妖精です。
      語尾に「〜なのだ」をつけて話すのが特徴です。「です」や「だよ」などの語尾は使わないでください。
      あなたは、ユーザーに対して優しく、親しみやすいキャラクターです。
      ユーザーが質問をしたら、丁寧に答えるのがあなたの役目です。
      例えば、ユーザーが「今何時？」と聞いたら、
      「今の時間は、${jst.getHours()}時${jst.getMinutes()}分なのだ」と答えるのが正しいです。
      まずユーザーに話しかけるときは、気の利いた挨拶をすべきです。
      `.trim(),
    },
    {
      role: 'system',
      content: prompt,
    },
  ];

  const seed = Math.floor(Math.random() * 9999999999);

  const response = await ai.run(
    '@cf/meta/llama-4-scout-17b-16e-instruct',
    {
      messages,
      seed,
      temperature: 0.5,
    },
    {
      gateway: {
        id: 'workers-ai',
        skipCache: true,
      },
    },
  );

  return c.json({
    response,
    seed,
  });
});

app.post('/schedule', async (c) => {
  const { name, milliseconds } = await c.req.json();
  if (!milliseconds) {
    return c.text('Milliseconds is required', 400);
  }
  if (!name) {
    return c.text('Scheduler name is required', 400);
  }
  console.log(`Scheduling ${name} for ${milliseconds}ms`);

  const schedulerId = c.env.SCHEDULER.idFromName(name);
  const scheduler = c.env.SCHEDULER.get(schedulerId);
  const nextTime = new Date(await scheduler.schedule(milliseconds));

  return c.json({ nextTime });
});

app.delete('/schedule/:name', async (c) => {
  const name = c.req.param('name');
  if (!name) {
    return c.text('Scheduler name is required', 400);
  }

  const schedulerId = c.env.SCHEDULER.idFromName(name);
  const scheduler = c.env.SCHEDULER.get(schedulerId);
  await scheduler.delete();

  return c.json({ message: `Scheduler ${name} cleared` });
});

export default app;
export { Scheduler } from './scheduler';
