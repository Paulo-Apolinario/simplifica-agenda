import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The build does not detect undefined JSX callback identifiers.
// Keep this focused regression guard until browser component tests are added.
const appPath = fileURLToPath(new URL("../../web/src/App.jsx", import.meta.url));
const source = fs.readFileSync(appPath, "utf8");
function component(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Expected ${name} and ${nextName} components`);
  return source.slice(start, end);
}
test("the appointment details completion button has a locally defined action", () => {
  const details = component("AppointmentDetails", "AgendaPage");
  const card = component("AppointmentCard", "ReceptionDashboard");
  assert.match(details, /const completeOwn = async \(\) =>/);
  assert.match(details, /onClick=\{completeOwn\}/);
  assert.match(details, /\/professional\/my-services\/\$\{encodeURIComponent\(appointment\.id\)\}\/complete/);
  assert.doesNotMatch(card, /const completeOwn = async/);
});
