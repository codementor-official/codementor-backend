export interface ProviderEmailStatus {
  email: string;
  verified: boolean;
  canSend: boolean;
}

/** Keycloak owns verification links, expiry and proof of mailbox ownership. */
export interface EmailVerificationProvider {
  emailStatus(externalId: string): Promise<ProviderEmailStatus>;
  sendVerificationEmail(externalId: string): Promise<void>;
}

export const EMAIL_VERIFICATION_PROVIDER = Symbol('EMAIL_VERIFICATION_PROVIDER');
