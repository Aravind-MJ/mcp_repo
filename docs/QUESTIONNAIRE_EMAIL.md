# Questionnaire email verification setup

Questionnaires with `authentication_type: "email_verified"` send a six-digit code by SMTP. The hub talks to any SMTP server that accepts authenticated submission over TLS. No provider is built into the code.

Until SMTP is configured, verified questionnaires still load. Requesting a code returns `503 Email verification is unavailable right now. No code was sent.` Respondents cannot fall back to self-reporting. `anonymous` and `self_report` questionnaires do not need SMTP.

## Settings

The service reads these environment variables at startup:

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `QUESTIONNAIRE_SMTP_HOST` | yes | none | SMTP server host name |
| `QUESTIONNAIRE_SMTP_FROM` | yes | none | `From` header, for example `Questionnaires <forms@example.com>` |
| `QUESTIONNAIRE_SMTP_PORT` | no | `587` | `465` uses implicit TLS. Any other port must offer STARTTLS. |
| `QUESTIONNAIRE_SMTP_SECURE` | no | `true` when the port is 465 | Set `true` or `false` to override |
| `QUESTIONNAIRE_SMTP_USER` | no | none | SMTP login. When set, the password file is required. |
| `QUESTIONNAIRE_SMTP_PASSWORD_FILE` | no | `<runtime>/secrets/questionnaire-smtp-password` | File holding only the SMTP password |
| `MCP_HUB_TRUST_PROXY` | no | `loopback` | Express `trust proxy` value. Keep `loopback` while Caddy runs on the same host, so the per-IP limit sees the real client address from `X-Forwarded-For`. Browser and MCP requests both use it. Set `false` only if nothing proxies the hub; then every request counts against its socket address. |

TLS is always required. The configuration has no switch to send codes over plain text.

The password is never read from an environment variable. The service reads the file each time it sends a code, so rotating the password needs no restart. It never logs the password, the code, or the proof. A failed delivery logs one line with the SMTP error code only.

## Store the password file without printing it

Run these as the service user on the host. Paste the password when `read` waits; the terminal does not echo it.

```sh
secret_file=/data/mcp-hub/secrets/questionnaire-smtp-password
umask 077
read -rs smtp_password
printf '%s' "$smtp_password" > "$secret_file"
unset smtp_password
chmod 600 "$secret_file"
```

For automation, pipe the value from your secret manager instead of `read`, for example `your-secret-tool get smtp-password | install -m 600 /dev/stdin "$secret_file"`.

## Option A: a transactional email provider

Most providers (SMTP2GO, Postmark, Mailgun, Amazon SES, Brevo, and others) give you a host, port 587 or 465, a username, and a password or API key. Before sending:

1. Verify the sending domain or address in the provider's dashboard.
2. Add the SPF and DKIM DNS records the provider lists. Without them, codes are more likely to land in spam.
3. Set `QUESTIONNAIRE_SMTP_HOST`, `QUESTIONNAIRE_SMTP_PORT`, `QUESTIONNAIRE_SMTP_USER`, and `QUESTIONNAIRE_SMTP_FROM`, then write the password file.

SMTP2GO rejected sign-up with a Gmail address, so the provider choice is still open.

### Example: Resend over generic SMTP

Resend works through the same settings as any other provider. Nothing in the code is specific to it.

1. Add a domain you control in the Resend dashboard, for example `forms.example.com`. Resend will not send from a domain you have not verified, and it does not send from `gmail.com` addresses.
2. Add the DNS records Resend lists for that domain at your DNS host: the DKIM `TXT` record, plus the `MX` and SPF `TXT` records for its bounce subdomain. Adding a DMARC `TXT` record at `_dmarc` is optional but lowers the chance of codes landing in spam. Wait until the dashboard shows the domain as verified.
3. Create an API key with sending access only. The key is the SMTP password.
4. Configure:

   ```sh
   QUESTIONNAIRE_SMTP_HOST=smtp.resend.com
   QUESTIONNAIRE_SMTP_PORT=465
   QUESTIONNAIRE_SMTP_USER=resend
   QUESTIONNAIRE_SMTP_FROM="Questionnaires <no-reply@forms.example.com>"
   ```

5. Write the API key to the password file as shown above.

Port 587 with STARTTLS also works; leave `QUESTIONNAIRE_SMTP_SECURE` unset so it defaults to `false` for that port. Until the DNS records verify, Resend rejects the message and the respondent sees "could not be sent. No code was sent".

## Option B: a Gmail account with an app password

This works for low volume. Consumer Gmail accounts allow about 500 messages a day, and Google may pause sending from an account that looks automated.

1. Turn on 2-Step Verification for the Google account.
2. Open <https://myaccount.google.com/apppasswords>, create an app password named for this service, and copy the 16-character value. Google shows it once.
3. Configure:

   ```sh
   QUESTIONNAIRE_SMTP_HOST=smtp.gmail.com
   QUESTIONNAIRE_SMTP_PORT=465
   QUESTIONNAIRE_SMTP_USER=you@gmail.com
   QUESTIONNAIRE_SMTP_FROM="Questionnaires <you@gmail.com>"
   ```

4. Write the app password, without spaces, to the password file as shown above.

`QUESTIONNAIRE_SMTP_FROM` must be the Gmail address or an alias already verified in Gmail's "Send mail as" settings. Gmail rewrites any other sender.

To revoke access, delete the app password in the Google account. Codes then fail with `502`, and no code is reported as sent.

## Check the setup

1. Restart the service so it reads the new environment.
2. Create a disposable questionnaire with `authentication_type: "email_verified"`.
3. Open its signed link, answer, press submit, and request a code to an inbox you control.
4. Confirm the email arrives, enter the code, and check that the response shows `identity_status: "email_verified"`.
5. Delete the disposable questionnaire.

Automated tests use a local fake SMTP peer. They show that the adapter speaks SMTP correctly. They do not show that a real provider accepts and delivers the message, so live delivery still needs step 3 above.

## Limits

| Rule | Value |
|---|---|
| Code lifetime | 10 minutes, single use |
| Wrong codes before lockout | 5, then a new code is needed |
| Resend cooldown | 60 seconds per response |
| Codes per email per questionnaire | 5 per hour |
| Codes per client IP | 20 per hour |
| Proof lifetime after a correct code | 30 minutes, consumed on submit |

Failed deliveries count toward the hourly limits. Expired verification rows and send records older than an hour are deleted when the next code is requested.
