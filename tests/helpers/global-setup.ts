import { migrate } from "../../scripts/migrate";

/** Migrates the test database once per run. Each test file resets data itself. */
export default async function setup() {
  const url = process.env.DATABASE_URL_OWNER;
  if (!url || !url.includes("/occasio_test")) throw new Error("tests must run against occasio_test");
  await migrate(url, () => {});
}
