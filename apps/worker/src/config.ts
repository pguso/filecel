export type WorkerConfig = {
  port: number;
  apiSecret: string;
  redisUrl: string;
  queueName: string;
  workerConcurrency: number;
  jobAttempts: number;
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  };
  frameuniverse: {
    apiUrl: string;
    webhookSecret: string;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(): WorkerConfig {
  return {
    port: Number(process.env.PORT ?? "3000"),
    apiSecret: requireEnv("WORKER_API_SECRET"),
    redisUrl: requireEnv("REDIS_URL"),
    queueName: process.env.BULLMQ_QUEUE_NAME ?? "persist-media",
    workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? "2"),
    jobAttempts: Number(process.env.JOB_ATTEMPTS ?? "3"),
    r2: {
      accountId: requireEnv("R2_ACCOUNT_ID"),
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
      bucket: requireEnv("R2_BUCKET")
    },
    frameuniverse: {
      apiUrl: requireEnv("FRAMEUNIVERSE_API_URL"),
      webhookSecret: requireEnv("FILECEL_WEBHOOK_SECRET")
    }
  };
}
