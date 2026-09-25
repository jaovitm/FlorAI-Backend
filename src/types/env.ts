export type Bindings = {
  DB: D1Database;
  BUCKET: R2Bucket;
};

export type AppEnv = {
  Bindings: Bindings;
};
