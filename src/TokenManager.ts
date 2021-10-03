import axios from "axios";
import { EventEmitter } from "stream";

export class TokenManager extends EventEmitter {
  private static readonly TOKEN_EXPIRE_TRESHOLD = 6e4

  private access_token: string;
  private refresh_token: string;
  private client_id: string;
  private client_secret: string;
  private token_expire: number = 0; // Expires now

  private constructor() {
    super();
  }

  public static create() {
    return new TokenManager();
  }

  public setAccessToken(token: string, expires?: number) {
    this.access_token = token;
    if (expires) this.token_expire = expires;
    return this;
  }

  public setRefreshToken(token: string) {
    this.refresh_token = token;
    return this;
  }

  public setClientCredentials(id: string, secret: string) {
    this.client_id = id;
    this.client_secret = secret;
    return this;
  }

  public canRefresh() {
    return !!this.refresh_token && !!this.client_id && !!this.client_secret;
  }

  public retrieveTokenSync() {
    if (!this.canRefresh()) {
      if (!this.access_token) throw new Error('No access token provided and cannot be refreshed');
      return this.access_token;
    }

    if (Date.now() > this.token_expire - TokenManager.TOKEN_EXPIRE_TRESHOLD) {
      return this.retrieveTokenSync();
    }

    return this.access_token;
  }

  public async retrieveToken() {
    if (!this.canRefresh()) {
      if (!this.access_token) throw new Error('No access token provided and cannot be refreshed');
      return this.access_token;
    }

    if (Date.now() > this.token_expire - TokenManager.TOKEN_EXPIRE_TRESHOLD) {
      if (!await this.refreshAccessToken()) {
        throw new Error('Failed to refresh access token');
      }

      return this.access_token;
    }

    return this.access_token;
  }

  private async refreshAccessToken() {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', this.refresh_token);

    const response = await axios.post('https://accounts.spotify.com/api/token', params, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.client_id}:${this.client_secret}`, 'utf8').toString('base64')}`
      },
      validateStatus: _ => true
    });

    if (response.status < 200 || response.status > 299) {
      return false;
    }

    const { access_token, expires_in } = response.data;

    this.access_token = access_token;
    this.token_expire = Date.now() + (expires_in * 1000);

    this.emit('token', access_token);

    return true;
  }
}