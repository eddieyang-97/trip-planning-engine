# Supabase database trust anchor

`supabase-prod-ca-2021.crt` is the public CA certificate linked by this project's Supabase dashboard under Database → Settings → SSL configuration. It contains no private key or credentials.

- Source: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt
- Retrieved: 9 October 2026
- SHA-256 certificate fingerprint: `80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA`
- Expires: 26 April 2031

The Render Blueprint sets `DATABASE_CA_FILE` to this file. The PostgreSQL adapter retains `rejectUnauthorized: true`, including certificate-chain and hostname validation. This trust anchor applies only to database connections; it does not modify global Node or operating-system trust.

If Supabase rotates the CA, obtain its replacement from the project dashboard, review its fingerprint and validity, test the pooler connection with verification enabled, and update the Blueprint path if needed. Never fix certificate errors by disabling verification.
