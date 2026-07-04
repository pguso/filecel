export type GenerationStatusValues = {
  processing: string;
  completed: string;
  failed: string;
};

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
    publicBaseUrl?: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
    generationsTable: string;
    assetsTable: string;
    generationStatus: GenerationStatusValues;
  };
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
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
      bucket: requireEnv("R2_BUCKET"),
      publicBaseUrl: optionalEnv("R2_PUBLIC_BASE_URL")
    },
    supabase: {
      url: requireEnv("SUPABASE_URL"),
      serviceRoleKey: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      generationsTable: process.env.SUPABASE_GENERATIONS_TABLE ?? "generations",
      assetsTable: process.env.SUPABASE_ASSETS_TABLE ?? "assets",
      generationStatus: {
        processing: process.env.GENERATION_STATUS_PROCESSING ?? "PROCESSING",
        completed: process.env.GENERATION_STATUS_COMPLETED ?? "COMPLETED",
        failed: process.env.GENERATION_STATUS_FAILED ?? "FAILED"
      }
    }
  };
}
