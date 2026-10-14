// Operator-only setup. Never prints or writes SMTP passwords to a local file.
// node --env-file=.env scripts/configure-keycloak-smtp.mjs [--apply] [--test-simulator]
//
// EMAIL_PROVIDER=ses  (default): SES SMTP, password derived from the IAM key; test recipient is
//                     the SES success simulator.
// EMAIL_PROVIDER=smtp: the same SMTP_* account notification-service uses (e.g. Gmail + app
//                     password). The test sends a real verification mail to a unique
//                     "+tag" alias of SMTP_USER, so it lands in the operator's own mailbox and
//                     can never collide with an existing user.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { SESv2Client, GetAccountCommand, GetEmailIdentityCommand } from '@aws-sdk/client-sesv2';

const e = process.env;
const apply = process.argv.includes('--apply');
const test = process.argv.includes('--test-simulator');
const required = (key, env = e) => {
  if (!env[key]) throw new Error(`Missing ${key}`);
  return env[key];
};
const request = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  // Do not log raw request/response bodies: they can contain credentials or tokens.
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${new URL(url).pathname}: HTTP ${response.status}`);
  return response;
};

async function main() {
  if (test && !apply) throw new Error('--test-simulator requires --apply');
  const base = new URL(required('KEYCLOAK_URL'));
  if (base.protocol !== 'https:') throw new Error('Use HTTPS when transmitting SMTP credentials to Keycloak');
  const realm = encodeURIComponent(required('KEYCLOAK_REALM'));
  const api = `${base.toString().replace(/\/$/, '')}/admin/realms/${realm}`;
  const useSmtp = e.EMAIL_PROVIDER === 'smtp';
  const region = useSmtp ? null : required('AWS_REGION');
  const from = useSmtp ? (e.EMAIL_FROM_ADDRESS || required('SMTP_USER')).trim() : required('SES_FROM_EMAIL');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) throw new Error('Invalid sender address');
  if (useSmtp) {
    required('SMTP_HOST');
    required('SMTP_PASSWORD');
  } else {
    if (e.AWS_SESSION_TOKEN || !required('AWS_ACCESS_KEY_ID').startsWith('AKIA')) {
      throw new Error('SES SMTP derivation requires an existing long-lived IAM access key, not temporary credentials');
    }
    required('AWS_SECRET_ACCESS_KEY');
  }
  const infra = parseEnv(readFileSync(e.INFRA_ENV_FILE ?? new URL('../../codementor-infra/.env', import.meta.url), 'utf8'));
  const adminToken = await (await request(new URL('/realms/master/protocol/openid-connect/token', base), {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password', client_id: 'admin-cli',
      username: required('KEYCLOAK_ADMIN_USERNAME', infra),
      password: required('KEYCLOAK_ADMIN_PASSWORD', infra),
    }),
  })).json();
  const headers = { Authorization: `Bearer ${adminToken.access_token}`, 'Content-Type': 'application/json' };
  const original = await (await request(api, { headers })).json();
  const verificationClient = e.KEYCLOAK_EMAIL_VERIFICATION_CLIENT_ID ?? 'codementor-web';
  const redirect = new URL('/profile?tab=settings', required('CLIENT_APP_URL')).toString();
  const clients = await (await request(`${api}/clients?clientId=${encodeURIComponent(verificationClient)}`, { headers })).json();
  if (clients.length !== 1 || !clients[0].redirectUris?.some((uri) =>
    uri === redirect || (uri.endsWith('/*') && redirect.startsWith(uri.slice(0, -1))))) {
    throw new Error('Verification client must already allow the Client Profile redirect; no client permissions were changed');
  }
  if (useSmtp) {
    console.log(JSON.stringify({
      phase: 'preflight', realm: original.realm, provider: 'smtp', host: e.SMTP_HOST.trim(), from, redirect,
      existingSmtp: Boolean(original.smtpServer?.host), apply,
    }));
  } else {
  const ses = new SESv2Client({ region, maxAttempts: 1 });
  try {
    const account = await ses.send(new GetAccountCommand({}));
    const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: from.split('@')[1] }));
    if (!account.SendingEnabled || !identity.VerifiedForSendingStatus) throw new Error('SES sending/domain verification is not ready');
    console.log(JSON.stringify({
      phase: 'preflight', realm: original.realm, region, from,
      sandbox: !account.ProductionAccessEnabled, redirect,
      existingSmtp: Boolean(original.smtpServer?.host), apply,
    }));
  } finally {
    ses.destroy();
  }
  }
  if (!apply) return;

  const smtp = useSmtp ? genericSmtp(original, from) : sesSmtp(original, from, region);
  await request(api, { method: 'PUT', headers, body: JSON.stringify({ smtpServer: smtp }) });
  const saved = await (await request(api, { headers })).json();
  for (const key of ['host', 'port', 'from', 'auth', 'ssl', 'starttls', 'user']) {
    if (saved.smtpServer?.[key] !== smtp[key]) throw new Error(`SMTP readback mismatch: ${key}`);
  }
  if (saved.verifyEmail !== original.verifyEmail) throw new Error('Unexpected verification-policy change');
  console.log(JSON.stringify({ phase: 'configured', host: smtp.host, port: smtp.port, ssl: smtp.ssl === 'true', starttls: smtp.starttls === 'true', loginPolicyUnchanged: true }));
  if (!test) return;

  // Isolated passwordless synthetic user; never alters an existing user's email.
  const username = `smtp-transport-check-${randomUUID()}`;
  const recipient = useSmtp ? plusAlias(required('SMTP_USER').trim(), username) : 'success@simulator.amazonses.com';
  return sendTestVerification({ api, base, realm, headers, original, username, recipient, verificationClient, redirect, provider: useSmtp ? `Keycloak -> ${smtp.host}` : 'Keycloak -> SES SMTP' });
}

function genericSmtp(original, from) {
  const port = Number(e.SMTP_PORT || 465);
  const secure = e.SMTP_SECURE ? e.SMTP_SECURE === 'true' : port === 465;
  return {
    ...(original.smtpServer ?? {}),
    host: e.SMTP_HOST.trim(), port: String(port),
    from, fromDisplayName: e.EMAIL_FROM_NAME || e.SES_FROM_NAME || 'CodeMentor', envelopeFrom: from,
    auth: 'true', ssl: String(secure), starttls: String(!secure),
    user: e.SMTP_USER.trim(),
    // Gmail shows app passwords in groups of four separated by spaces; SMTP wants them joined.
    password: e.SMTP_PASSWORD.replace(/\s+/g, ''),
  };
}

/** `name@gmail.com` -> `name+tag@gmail.com`: same mailbox, address no real user owns. */
function plusAlias(address, tag) {
  const [local, domain] = address.split('@');
  return `${local.split('+')[0]}+${tag.slice(-12)}@${domain}`;
}

function sesSmtp(original, from, region) {
  // AWS-documented region-specific SES SMTP derivation. This grants no new IAM permissions.
  // https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html
  let signature = Buffer.from(`AWS4${e.AWS_SECRET_ACCESS_KEY}`);
  for (const message of ['11111111', region, 'ses', 'aws4_request', 'SendRawEmail']) {
    signature = createHmac('sha256', signature).update(message).digest();
  }
  return {
    ...(original.smtpServer ?? {}),
    host: `email-smtp.${region}.amazonaws.com`, port: '587',
    from, fromDisplayName: e.SES_FROM_NAME ?? 'CodeMentor', envelopeFrom: from,
    auth: 'true', ssl: 'false', starttls: 'true',
    user: e.AWS_ACCESS_KEY_ID,
    password: Buffer.concat([Buffer.from([4]), signature]).toString('base64'),
  };
}

async function sendTestVerification({ api, base, realm, headers, original, username, recipient, verificationClient, redirect, provider }) {
  // Keycloak may normalize every username to its email address at creation.
  const expectedUsername = original.registrationEmailAsUsername ? recipient : username;
  const existing = await (await request(`${api}/users?email=${encodeURIComponent(recipient)}&exact=true`, { headers })).json();
  if (existing.length) throw new Error('Test recipient already exists; refusing to reuse or delete it');
  const created = await request(`${api}/users`, {
    method: 'POST', headers,
    body: JSON.stringify({ username, email: recipient, enabled: true, emailVerified: false }),
  });
  const location = created.headers.get('location');
  if (!location) throw new Error(`Test fixture ${username} created without Location; manual cleanup required`);
  const id = new URL(location).pathname.split('/').at(-1);
  if (!id) throw new Error(`Test fixture ${username} returned no ID; manual cleanup required`);
  const fixtureUrl = `${api}/users/${encodeURIComponent(id)}`;
  try {
    const fixture = await (await request(fixtureUrl, { headers })).json();
    if (fixture.username !== expectedUsername || fixture.email !== recipient) throw new Error('Test fixture identity mismatch');
    const token = await (await request(new URL(`/realms/${realm}/protocol/openid-connect/token`, base), {
      method: 'POST', body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: required('KEYCLOAK_USER_SERVICE_CLIENT_ID'),
        client_secret: required('KEYCLOAK_USER_SERVICE_CLIENT_SECRET'),
      }),
    })).json();
    const query = new URLSearchParams({ client_id: verificationClient, redirect_uri: redirect, lifespan: '1800' });
    await request(`${fixtureUrl}/send-verify-email?${query}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token.access_token}` },
    });
    console.log(JSON.stringify({ phase: 'test-send', accepted: true, provider, recipient }));
  } finally {
    const fixture = await (await request(fixtureUrl, { headers })).json();
    if (fixture.username !== expectedUsername || fixture.email !== recipient) throw new Error('Refusing to delete unexpected test fixture');
    await request(fixtureUrl, { method: 'DELETE', headers });
    console.log(JSON.stringify({ phase: 'cleanup', temporaryUserRemoved: true }));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ error: error.message }));
  process.exitCode = 1;
});
