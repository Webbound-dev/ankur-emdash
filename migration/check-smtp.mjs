// Exercise the Cloudflare adapter without credentials or outbound email.
import assert from "node:assert/strict";
import { createPlugin } from "../src/plugins/smtp-cloudflare.mjs";
import { createSmtpSender } from "../src/plugins/smtp-transport.mjs";

const plugin = createPlugin(), requests = [], logs = [];
const settings = new Map([
	["settings:global", { primaryProviderId: "resend", fromEmail: "sender@example.com", fromName: "Ankur Salt", logLevel: "all" }],
	["settings:provider:resend", { apiKey: "test-key" }],
]);
const ctx = {
	plugin: { id: plugin.id, version: plugin.version },
	kv: { get: async (key) => settings.get(key) ?? null, set: async (key, value) => settings.set(key, value) },
	http: { fetch: async (url, init) => {
		requests.push({ url, init });
		return new Response(JSON.stringify({ id: "test-message" }), { status: 200 });
	} },
	storage: { deliveryLogs: { put: async (_id, record) => logs.push(record) } },
	log: { warn() {}, error() {}, info() {} },
};
const event = { source: "test", message: { to: "recipient@example.com", subject: "SMTP check", text: "Test", html: "<p>Test</p>" } };
const send = () => plugin.hooks["email:deliver"].handler(event, ctx);
await send();
assert.equal(requests.length, 1);
assert.equal(requests[0].url, "https://api.resend.com/emails");
const payload = JSON.parse(requests[0].init.body);
assert.equal(payload.subject, event.message.subject);
assert.equal(payload.html, event.message.html);
assert.equal(logs[0].status, "sent");
assert.equal(logs[0].remoteMessageId, "test-message");
ctx.http.fetch = async () => new Response("provider rejected", { status: 503 });
await assert.rejects(send());
assert.equal(logs.at(-1).status, "failed");
settings.delete("settings:provider:resend");
await assert.rejects(send(), /settings are incomplete/);
const admin = await plugin.routes.admin.handler({ ...ctx, input: { type: "page_load", page: "/providers" } });
assert(admin);
assert(!JSON.stringify(admin).includes("Marketplace install"));
settings.set("settings:global", { primaryProviderId: "zoho", fromEmail: "sender@example.com", logLevel: "all" });
settings.set("state:selectedProviderId", "phpmail");
const repaired = await plugin.routes.admin.handler({ ...ctx, input: { type: "page_load", page: "/providers" } });
assert.equal(settings.get("state:selectedProviderId"), "zoho");
assert(repaired.blocks.some((block) => block.type === "section" && block.text === "Zoho Mail setup"));
assert(repaired.blocks.some((block) => block.type === "form" && block.block_id === "provider-settings"));
assert(!JSON.stringify(repaired).includes("Use Generic SMTP"));
const rejected = await plugin.routes.admin.handler({ ...ctx, input: { type: "action", action_id: "select_provider:phpmail" } });
assert.equal(settings.get("state:selectedProviderId"), "zoho");
assert.equal(rejected.toast.type, "error");
assert.equal(settings.get("settings:global").primaryProviderId, "zoho");
const generic = await plugin.routes.admin.handler({ ...ctx, input: { type: "action", action_id: "select_provider:generic" } });
assert.equal(settings.get("state:selectedProviderId"), "generic");
assert(generic.blocks.some((block) => block.type === "form" && block.block_id === "provider-settings"));
const picker = generic.blocks.find((block) => block.block_id === "provider-browser");
assert(picker.fields[0].options.some((option) => option.value === "generic"));
assert(!picker.fields[0].options.some((option) => option.value === "phpmail"));
const providerForm = generic.blocks.find((block) => block.block_id === "provider-settings");
assert(!providerForm.fields.find((field) => field.action_id === "security").options.some((option) => option.value === "none"));
// Changed-fields-only submissions must preserve credentials and save defaults.
settings.set("settings:provider:generic", { host: "smtp.zeptomail.in", username: "emailapikey", password: "saved-test-password" });
await plugin.routes.admin.handler({ ...ctx, input: { type: "form_submit", action_id: "save_provider", values: { host: "smtp.zeptomail.in" } } });
assert.deepEqual(settings.get("settings:provider:generic"), { host: "smtp.zeptomail.in", username: "emailapikey", password: "saved-test-password", port: 587, security: "starttls" });
await plugin.routes.admin.handler({ ...ctx, input: { type: "form_submit", action_id: "save_provider", values: { port: 465, security: "ssl", password: "" } } });
assert.equal(settings.get("settings:provider:generic").port, 465);
assert.equal(settings.get("settings:provider:generic").security, "ssl");
assert.equal(settings.get("settings:provider:generic").password, "saved-test-password");
// A configured editor selection must not silently send through another provider.
const requestCount = requests.length;
const blocked = await plugin.routes.admin.handler({ ...ctx, input: { type: "form_submit", action_id: "send_test", values: { to: "recipient@example.com" } } });
assert.match(blocked.toast.message, /Zoho Mail.*settings are incomplete/);
assert.equal(settings.get("state:lastTestResult").status, "failed");
assert.equal(requests.length, requestCount);
await plugin.routes.admin.handler({ ...ctx, input: { type: "action", action_id: "set_primary_provider", value: "generic" } });
assert.equal(settings.get("settings:global").primaryProviderId, "generic");
let options, mailMessage, closed = 0;
const smtp = createSmtpSender((value) => {
 options = value;
 return { sendMail: async (message) => { mailMessage = message; return { messageId: "smtp-id" }; }, close: () => closed++ };
});
const config = { host: "smtp.zeptomail.in", port: 465, secure: true, username: "emailapikey", password: "test-password" };
const message = { fromEmail: "sender@example.com", fromName: "Ankur Salt", to: ["recipient@example.com"], subject: "Test", text: "Test", replyTo: ["reply@example.com"], attachments: [{ filename: "request.txt", content: Buffer.from("attachment bytes"), contentType: "text/plain" }] };
assert.deepEqual(await smtp(config, message), { remoteMessageId: "smtp-id" });
assert.equal(options.secure, true);
assert.deepEqual(options.auth, { user: "emailapikey", pass: "test-password" });
assert.deepEqual(mailMessage.from, { address: message.fromEmail, name: message.fromName });
assert.deepEqual(mailMessage.replyTo, message.replyTo);
assert.deepEqual(mailMessage.attachments, message.attachments);
assert.equal(closed, 1);
await smtp({ ...config, port: 587, secure: false }, message);
assert.equal(options.requireTLS, true);
await assert.rejects(smtp({ ...config, port: 25 }, message), /465 or 587/);
await assert.rejects(smtp(config, { ...message, fromEmail: undefined }), /sender email/);
const failed = createSmtpSender(() => ({ sendMail: async () => { throw new Error("Authentication failed"); }, close: () => closed++ }));
await assert.rejects(failed(config, message), /Authentication failed/);
assert.equal(closed, 3);
console.log("PASS: HTTP delivery/logs, SMTP settings and cleanup, provider filtering, Generic SMTP editor and stale selection recovery. No real email sent.");
