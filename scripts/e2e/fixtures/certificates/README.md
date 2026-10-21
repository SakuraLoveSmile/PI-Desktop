# Local TLS fixture

The certificate and unencrypted private key are public test data for localhost,
not production credentials. The key must never be used outside tests. The
self-signed certificate has a DNS SAN for `localhost` only; requests to
`127.0.0.1` must fail hostname validation even when its CA is trusted.

Generated with OpenSSL (valid for ten years from September 20, 2026):

```sh
openssl req -x509 -newkey rsa:2048 -nodes -keyout localhost-key.pem \
  -out localhost-cert.pem -sha256 -days 3650 -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost'
```

The E2E test supplies the certificate only through a child process's
`NODE_EXTRA_CA_CERTS`. It never modifies the machine's certificate stores.

`expired-system-ca.crt` is a public, self-signed CA-only fixture with subject
`CN=Expired system CA test fixture`, valid from January 1, 2020 through
January 1, 2021. Its private key is not stored. The CA merge unit test freezes
time at October 22, 2026 and supplies this expired root alongside the valid
localhost certificate at the TLS API boundary, independent of the host OS store.
