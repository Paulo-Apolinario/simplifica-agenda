import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const appFile = fileURLToPath(new URL("../../web/src/App.jsx", import.meta.url));
const app = fs.readFileSync(appFile, "utf8");

test("every Navigate element used by the router is imported", () => {
  const routerImport = app.match(/import\s*\{([^}]+)\}\s*from\s*["']react-router-dom["']/);
  assert.ok(routerImport, "Expected named imports from react-router-dom");
  for (const component of ["Navigate", "NavLink", "Routes", "Route", "Link"]) {
    if (app.includes(`<${component}`)) {
      assert.match(routerImport[1], new RegExp(`\\b${component}\\b`),
        `${component} is rendered but not imported, causing a blank screen`);
    }
  }
});
