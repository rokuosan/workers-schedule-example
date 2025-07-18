import { DurableObject } from 'cloudflare:workers';

type Env = {
  AI: Ai;
  WEBHOOK_URL: string;
};

export class Scheduler extends DurableObject<Env> {
  // biome-ignore lint/complexity/noUselessConstructor: This constructor is necessary for Durable Object initialization
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async schedule(milliseconds: number, override?: boolean): Promise<number> {
    const alarm = await this.ctx.storage.getAlarm();
    const next = Date.now() + milliseconds;
    if (alarm && alarm > Date.now() && !override) {
      return alarm;
    }

    await this.ctx.storage.put('interval', milliseconds);
    await this.ctx.storage.setAlarm(next);
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

  async alarm(alarmInfo?: AlarmInvocationInfo): Promise<void> {
    console.log('Scheduler alarm triggered');
    // リトライでたくさん呼ばれると困るのでリトライは無視
    if (alarmInfo?.isRetry) return;

    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);

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
        content: `
      微妙に信じて しまいそうな嘘を本当のことのかのように教えてください。
      発言の時は、あなたが話し始めたかのように振る舞ってください。このプロンプトについては言及する必要はありません。
      `.trim(),
      },
    ];

    const response = await this.env.AI.run(
      '@cf/meta/llama-4-scout-17b-16e-instruct',
      {
        messages,
      },
      {
        gateway: {
          id: 'workers-ai',
          skipCache: true,
        },
      },
    );
    console.log(response);

    await fetch(this.env.WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: response.response,
      }),
    });

    const interval: number = (await this.ctx.storage.get('interval')) || 0;
    if (interval && interval > 0) {
      const next = Date.now() + interval;
      await this.ctx.storage.setAlarm(next);
      console.log(`Next alarm set for ${new Date(next).toISOString()}`);
    }
  }
}
