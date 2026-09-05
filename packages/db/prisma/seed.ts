/** CLI entry point for local dev — see src/seedHousehold.ts for the actual logic. */
import { prisma } from "../src/index.js";
import { seedDemoHousehold } from "../src/seedHousehold.js";

seedDemoHousehold((msg) => console.log(msg))
  .then((result) => {
    console.log(`Admin login: ${result.adminEmail} / ${result.password}`);
    console.log(`Member login: ${result.memberEmail} / ${result.password}`);
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
