// Exercises the actual API handlers with a mocked email provider. No mail is sent.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.resolve('astro'));
const { build } = require('esbuild');
const env = globalThis.__formTestEnv = {};
const recipients = globalThis.__formTestRecipients = {};
const smtpSettings = globalThis.__formSmtpSettings = {};
const config = {
  OTP_SIGNING_SECRET: 'test-only-secret',
};
const cases = [
  ['submit-contact-general', 'CONTACT_GENERAL_EMAIL', 'contact_general', 'ContactUs.astro'],
  ['submit-contact-industrial', 'CONTACT_INDUSTRIAL_EMAIL', 'contact_industrial', 'ContactUs.astro', true],
  ['submit-bulk-enquiry', 'BULK_ENQUIRY_EMAIL', 'bulk_enquiry', 'IndustrialSalt.astro', true],
  ['submit-distributor-application', 'BECOME_DISTRIBUTOR_EMAIL', 'distributor_application', 'BecomeDistributorForm.tsx'],
  ['submit-connect-distributor', 'CONNECT_DISTRIBUTOR_EMAIL', 'connect_distributor', 'ConnectWithDistributorForm.tsx'],
  ['submit-export-inquiry', 'EXPORT_INQUIRY_EMAIL', 'export_inquiry', 'ExportInquiryForm.tsx'],
  ['submit-newsletter', 'NEWSLETTER_SIGNUP_EMAIL', 'newsletter_signup', 'Footer.tsx'],
  ['submit-datasheet-request', 'DATASHEET_REQUEST_EMAIL', null, 'IndustrialSalt.astro'],
  ['submit-career-application', 'CAREER_APPLICATION_EMAIL', 'career_application', 'Careers.astro'],
];
const email = 'applicant@example.com';
const code = '123456';
const payload = Buffer.from(JSON.stringify({ email, expiresAt: Date.now() + 60_000,
  codeHash: createHash('sha256').update(`${code}.${config.OTP_SIGNING_SECRET}.${email}`).digest('base64url'),
})).toString('base64url');
const token = `${payload}.${createHmac('sha256', config.OTP_SIGNING_SECRET).update(payload).digest('base64url')}`;
const fixture = { name: '<Alice>', email, phone: '1234567890', city: 'Ahmedabad', state: 'Gujarat',
  company: 'Test company', companyName: 'Test company', businessName: 'Test company',
  contactName: 'Alice', subject: 'Test inquiry', country: 'India', message: 'Test message',
  industry: 'Other', industryOther: 'Test industry', grade: 'Other', gradeOther: 'Test grade',
  quantity: '1 tonne', location: 'Ahmedabad', team: 'Operations', recaptchaToken: 'test-recaptcha', token, code,
};
const originalFetch = globalThis.fetch;
let checks = 0;
try {
  for (const [route, recipient, action, ui, multipart] of cases) {
    assert.ok(readFileSync(`src/ui/components/${ui}`, 'utf8').includes(`/api/${route}`), `${route}: UI endpoint`);
    const bundle = await build({ entryPoints: [`src/pages/api/${route}.ts`], bundle: true, write: false,
      platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' },
      plugins: [{ name: 'test-worker-env', setup(build) {
        build.onResolve({ filter: /^emdash$/ }, () => ({ path: 'settings', namespace: 'test-emdash' }));
        build.onLoad({ filter: /.*/, namespace: 'test-emdash' }, () => ({ contents: 'export async function getPluginSetting(pluginId, key) { if(pluginId !== "emdash-smtp") throw new Error("Wrong plugin"); return key === "formRecipients" ? globalThis.__formTestRecipients : globalThis.__formSmtpSettings[key]; }' }));
        build.onResolve({ filter: /smtp-transport\.mjs$/ }, () => ({ path: 'smtp', namespace: 'test-smtp' }));
        build.onLoad({ filter: /.*/, namespace: 'test-smtp' }, () => ({ contents: 'export const smtpSend = (...args) => globalThis.__formSmtpSend(...args);' }));
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'test-env' }));
        build.onLoad({ filter: /.*/, namespace: 'test-env' }, () => ({ contents: 'export const env = globalThis.__formTestEnv;' }));
      } }],
    });
    const { POST } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const request = (data = fixture) => {
      if (!multipart) return new Request(`http://localhost/api/${route}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const form = new FormData();
      for (const [key, value] of Object.entries(data)) form.set(key, value);
      form.set('attachment', new File(['test attachment'], 'request.txt', { type: 'text/plain' }));
      return new Request(`http://localhost/api/${route}`, { method: 'POST', body: form });
    };
    const reset = () => {
      for (const key of Object.keys(env)) delete env[key];
      for (const key of Object.keys(recipients)) delete recipients[key];
      Object.assign(env, config, { [recipient]: 'recipient@example.com' });
      smtpSettings.global = { primaryProviderId: 'generic', fromEmail: 'sender@example.com', fromName: 'Ankur Salt' };
      smtpSettings['provider:generic'] = { host: 'smtp.example.com', port: 465, security: 'ssl', username: 'emailapikey', password: 'test-only-password' };
    };
    reset();
    let calls = [];
    globalThis.fetch = async () => { throw new Error('Forms must not call the old email HTTP API'); };
    globalThis.__formSmtpSend = async (settings, message) => {
      assert.equal(settings.host, 'smtp.example.com');
      assert.equal(settings.port, 465);
      assert.equal(settings.secure, true);
      assert.equal(message.fromEmail, 'sender@example.com');
      calls.push(message);
      return { remoteMessageId: 'test-id' };
    };
    let response = await POST({ request: request(), locals: {} });
    assert.equal(response.status, 200, route);
    assert.equal((await response.json()).ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].to[0], 'recipient@example.com');
    assert.ok(calls[0].html.includes(email));
    if (calls[0].html.includes('Alice')) assert.ok(!calls[0].html.includes('<Alice>'));
    if (multipart) assert.equal(Buffer.from(calls[0].attachments[0].content).toString(), 'test attachment');
    checks++;

    recipients[recipient] = 'edited-in-admin@example.com';
    calls = [];
    response = await POST({ request: request(), locals: {} });
    assert.equal(response.status, 200);
    assert.equal(calls[0].to[0], 'edited-in-admin@example.com');
    checks++;
    recipients[recipient] = 'invalid-address';
    calls = [];
    response = await POST({ request: request(), locals: {} });
    assert.equal(response.status, 502);
    assert.equal(calls.length, 0);
    checks++;
    delete recipients[recipient];

    delete smtpSettings.global;
    calls = [];
    response = await POST({ request: request(), locals: {} });
    assert.equal(response.status, 502);
    assert.equal(calls.length, 0);
    assert.ok((await response.json()).error.includes('SMTP'));
    checks++;

    reset();
    globalThis.__formSmtpSend = async () => { throw new Error('SMTP provider unavailable'); };
    response = await POST({ request: request(), locals: {} });
    assert.equal(response.status, 502);
    assert.ok((await response.json()).error);
    checks++;

    globalThis.fetch = async () => { throw new Error('No request should be made for invalid input'); };
    response = await POST({ request: request({}), locals: {} });
    assert.equal(response.status, 400);
    checks++;

    if (action) {
      env.RECAPTCHA_SECRET_KEY = 'test-recaptcha-secret';
      globalThis.fetch = async (url, init) => {
        assert.equal(url, 'https://www.google.com/recaptcha/api/siteverify');
        assert.equal(init.body.get('response'), 'test-recaptcha');
        return Response.json({ success: true, score: 0.1, action });
      };
      response = await POST({ request: request(), locals: {} });
      assert.equal(response.status, 400);
      checks++;
    } else {
      response = await POST({ request: request({ ...fixture, code: '000000' }), locals: {} });
      assert.equal(response.status, 400);
      checks++;
    }
    console.log(`OK ${route}: email request, missing config, provider failure, validation, verification`);
  }
} finally {
  globalThis.fetch = originalFetch;
  delete globalThis.__formTestEnv;
  delete globalThis.__formTestRecipients;
  delete globalThis.__formSmtpSettings;
  delete globalThis.__formSmtpSend;
}
console.log(`OK ${checks} backend checks across ${cases.length} forms. Provider mocked; inbox delivery not tested.`);
