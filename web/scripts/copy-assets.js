import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const source = path.join(root, "assets");
const destination = path.join(here, "../public/assets");

fs.mkdirSync(destination, { recursive: true });
for (const name of ["simplifica-perfil.svg", "simplifica-perfil.png", "simplifica-logo.svg"]) {
  const file = path.join(source, name);
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(destination, name));
}
