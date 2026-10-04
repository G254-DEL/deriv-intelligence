export type AuthConnectionStatus =
  | "signed_out"
  | "unconfigured"
  | "connecting"
  | "authenticating"
  | "authenticated"
  | "error";

export type AccountKind = "demo" | "real" | "unknown";

export type LinkedAccount = {
  loginid: string;
  currency: string;
  kind: AccountKind;
};

export type AccountSnapshot = {
  status: AuthConnectionStatus;
  detail: string | null;
  loginid: string | null;
  currency: string | null;
  balance: number | null;
  kind: AccountKind | null;
  accounts: LinkedAccount[];
  configured: boolean;
};

export type OAuthAccountToken = {
  loginid: string;
  currency: string;
  token: string;
};

export type ParsedOAuthRedirect =
  | {
      type: "legacy_tokens";
      accounts: OAuthAccountToken[];
    }
  | {
      type: "oauth2_code";
      code: string;
      state: string;
    }
  | {
      type: "error";
      message: string;
    }
  | {
      type: "none";
    };
