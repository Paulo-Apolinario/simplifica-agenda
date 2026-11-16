import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const { db } = await import("./database.js");
if (!db.prepare("SELECT 1 FROM tenants LIMIT 1").get()) await import("./seed.js");
const { default: app } = await import("./app.js");

const port = Number(process.env.PORT ?? 3000);
app.listen(port, "0.0.0.0", () => {
  console.log(`Simplifica Agenda disponível em http://localhost:${port}`);
});
