export default async function setup() {
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://gasman:gasman@localhost:5432/gasman_tms_test';
  const { migrate } = await import('../src/db/migrate');
  const { seedDemo } = await import('../src/seed/seedDemo');
  const { sequelize } = await import('../src/db/sequelize');
  await migrate(false);
  await seedDemo({ log: false });
  await sequelize.close();
}
