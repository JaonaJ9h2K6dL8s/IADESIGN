import { AsyncEntry } from '@napi-rs/keyring';

export class CredentialVault {
  constructor(private readonly service = 'AI Design Studio') {}

  get(account: string) {
    return new AsyncEntry(this.service, account).getPassword();
  }

  set(account: string, secret: string) {
    return new AsyncEntry(this.service, account).setPassword(secret);
  }

  delete(account: string) {
    return new AsyncEntry(this.service, account).deletePassword();
  }
}
