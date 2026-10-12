import assert from "node:assert/strict";
import { createPlugin } from "../src/plugins/smtp-cloudflare.mjs";
import { FORM_RECIPIENT_FIELDS, FORM_RECIPIENTS_KEY } from "../src/lib/formRecipientSettings.mjs";

const plugin = createPlugin();
assert(plugin.admin.pages.some((page) => page.path === "/form-recipients"));
const saved = new Map();
const settings = { get: async (key) => saved.get(key), set: async (key, value) => saved.set(key, value) };
const call = (input) => plugin.routes.admin.handler({ input, settings });
const page = await call({ type: "page_load", page: "/form-recipients" });
const form = page.blocks.find((block) => block.type === "form");
assert.equal(form.fields.length, 9);
assert.equal(form.fields.find((field) => field.action_id === "EXPORT_INQUIRY_EMAIL").initial_value, "export@ankurgroup.in");
let result = await call({ type: "form_submit", action_id: "save_form_recipients", values: { CONTACT_GENERAL_EMAIL: " new-inbox@example.com " } });
assert.equal(result.toast.type, "success");
assert.equal(saved.get(FORM_RECIPIENTS_KEY).CONTACT_GENERAL_EMAIL, "new-inbox@example.com");
assert.equal(saved.get(FORM_RECIPIENTS_KEY).EXPORT_INQUIRY_EMAIL, "export@ankurgroup.in");
const before = structuredClone(saved.get(FORM_RECIPIENTS_KEY));
for (const value of ["", "invalid", "a@example.com,b@example.com", "a@example.com\r\nBcc: b@example.com", null]) {
	result = await call({ type: "form_submit", action_id: "save_form_recipients", values: { BULK_ENQUIRY_EMAIL: value, CONTACT_GENERAL_EMAIL: "should-not-save@example.com" } });
	assert.equal(result.toast.type, "error");
	assert.deepEqual(saved.get(FORM_RECIPIENTS_KEY), before);
}
result = await call({ type: "form_submit", action_id: "save_form_recipients", values: { EXPORT_INQUIRY_EMAIL: "exports-new@example.com" } });
assert.equal(result.toast.type, "success");
const reloaded = await call({ type: "page_load", page: "/form-recipients" });
assert.equal(reloaded.blocks.find((block) => block.type === "form").fields.find((field) => field.action_id === "EXPORT_INQUIRY_EMAIL").initial_value, "exports-new@example.com");
assert.equal(Object.keys(saved.get(FORM_RECIPIENTS_KEY)).length, FORM_RECIPIENT_FIELDS.length);
console.log("PASS: 9 recipient fields, current defaults, persistent edits, partial saves and atomic validation. No email sent.");
