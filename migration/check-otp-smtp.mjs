import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { verifyOtpToken } from '../src/lib/otp.ts';
const require = createRequire(import.meta.resolve('astro'));
const { build } = require('esbuild');
globalThis.__otpEnv = { OTP_SIGNING_SECRET: 'test-only-secret' };
let configured = true, fail = false, sent;
globalThis.__otpSettings = (key) => !configured ? undefined : key === 'global'
  ? { primaryProviderId: 'generic', fromEmail: 'sender@example.com' }
  : { host: 'smtp.example.com', port: 465, security: 'ssl', username: 'emailapikey', password: 'test-password' };
globalThis.__otpSend = async (config, message) => {
  if (fail) throw new Error('SMTP failed');
  assert.equal(config.secure, true);
  sent = message;
  return { remoteMessageId: 'test-id' };
};
const bundle = await build({ entryPoints: ['src/pages/api/send-otp.ts'], bundle: true, write: false,
  platform: 'node', format: 'esm', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'test-host', setup(build) {
    build.onResolve({ filter: /^emdash$/ }, () => ({ path: 'settings', namespace: 'test' }));
    build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'env', namespace: 'test' }));
    build.onResolve({ filter: /smtp-transport\.mjs$/ }, () => ({ path: 'smtp', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'env'
      ? 'export const env = globalThis.__otpEnv;'
      : path === 'settings' ? 'export const getPluginSetting = (_id,key) => globalThis.__otpSettings(key);'
      : 'export const smtpSend = (...args) => globalThis.__otpSend(...args);' }));
  } }] });
const { POST } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const request = (email = 'visitor@example.com') => ({ request: new Request('http://localhost/api/send-otp', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
}), locals: {} });
try {
  let response = await POST(request());
  assert.equal(response.status, 200);
  const { token } = await response.json();
  const code = sent.html.match(/<strong>(\d{6})<\/strong>/)[1];
  assert.deepEqual(sent.to, ['visitor@example.com']);
  assert.equal(sent.subject, 'Your Ankur Salt verification code');
  assert.equal(verifyOtpToken(token, code, globalThis.__otpEnv.OTP_SIGNING_SECRET).ok, true);
  assert(!JSON.stringify({ token }).includes(code));
  configured = false;
  response = await POST(request());
  assert.equal(response.status, 502);
  assert(!(await response.json()).token);
  configured = true; fail = true;
  response = await POST(request());
  assert.equal(response.status, 502);
  assert(!(await response.json()).token);
  response = await POST(request('invalid'));
  assert.equal(response.status, 400);
  delete globalThis.__otpEnv.OTP_SIGNING_SECRET;
  response = await POST(request());
  assert.equal(response.status, 500);
  console.log('PASS: SMTP OTP recipient/template, token verification, missing config, provider failure and invalid input. No email sent.');
} finally {
  delete globalThis.__otpEnv; delete globalThis.__otpSettings; delete globalThis.__otpSend;
}
