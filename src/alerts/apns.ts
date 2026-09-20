export interface APNsConfiguration {
  keyID: string;
  teamID: string;
  privateKeyPEM: string;
  topic: string;
  sandbox?: boolean;
}

export class APNsError extends Error {
  constructor(readonly status: number, readonly reason: string | null) {
    super(`APNs returned ${status}${reason === null ? "" : `: ${reason}`}`);
  }
}

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemBytes(pem: string): ArrayBuffer {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

export class APNsHTTPClient {
  private readonly config: APNsConfiguration;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: APNsConfiguration) {
    this.config = config;
  }

  private async bearer(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.token !== null && this.token.expiresAt > now + 60) return this.token.value;
    const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "ES256", kid: this.config.keyID })));
    const claims = base64url(new TextEncoder().encode(JSON.stringify({ iss: this.config.teamID, iat: now })));
    const key = await crypto.subtle.importKey("pkcs8", pemBytes(this.config.privateKeyPEM), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${header}.${claims}`));
    const value = `${header}.${claims}.${base64url(signature)}`;
    this.token = { value, expiresAt: now + 50 * 60 };
    return value;
  }

  async send(token: string, payload: Record<string, unknown>): Promise<void> {
    const host = this.config.sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const response = await fetch(`https://${host}/3/device/${token}`, {
      method: "POST",
      headers: { authorization: `bearer ${await this.bearer()}`, "apns-topic": this.config.topic, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let reason: string | null = null;
      try { reason = (await response.json() as { reason?: string }).reason ?? null; } catch { /* response may not be JSON */ }
      throw new APNsError(response.status, reason);
    }
  }
}
