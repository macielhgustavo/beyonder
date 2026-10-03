export interface EmailVerificationBroker {
  findVerificationLink(providerId: string, since: Date): Promise<string | undefined>;
}

export class NoopEmailVerificationBroker implements EmailVerificationBroker {
  async findVerificationLink(): Promise<string | undefined> {
    return undefined;
  }
}
