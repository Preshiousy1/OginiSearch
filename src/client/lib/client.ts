import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

/**
 * HTTP client configuration options
 */
export interface ClientOptions {
  baseURL: string;
  timeout?: number;
  maxRetries?: number;
  retryDelay?: number;
  apiKey?: string;
}

/**
 * Error response from the API
 */
export interface ErrorResponse {
  statusCode: number;
  message: string;
  error?: string;
}

/**
 * Client error class for handling API errors
 */
export class ClientError extends Error {
  statusCode: number;
  error?: string;

  constructor(message: string, statusCode: number, error?: string) {
    super(message);
    this.name = 'ClientError';
    this.statusCode = statusCode;
    this.error = error;
  }
}

/**
 * Base HTTP client for ConnectSearch API
 */
export class ConnectSearchClient {
  private client: AxiosInstance;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  /**
   * Create a new ConnectSearch client
   * @param options Client configuration options
   */
  constructor(options: ClientOptions) {
    const { baseURL, timeout = 10000, maxRetries = 3, retryDelay = 300, apiKey } = options;

    this.maxRetries = maxRetries;
    this.retryDelay = retryDelay;

    // Create axios instance
    this.client = axios.create({
      baseURL,
      timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey && { Authorization: `Bearer ${apiKey}` }),
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      response => response,
      async error => {
        return this.handleRequestError(error);
      },
    );
  }

  /**
   * Handle request errors with retry logic
   * @param error Axios error
   * @param retryCount Current retry count
   * @param originalRequest Original axios request
   * @private
   */
  private async handleRequestError(
    error: any,
    retryCount = 0,
    originalRequest?: any,
  ): Promise<any> {
    const request = originalRequest || error.config;

    // Only retry on network errors or 5xx responses
    const shouldRetry =
      (error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        (error.response && error.response.status >= 500)) &&
      retryCount < this.maxRetries;

    if (shouldRetry) {
      retryCount++;

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, this.retryDelay * retryCount));

      // Retry the request
      return this.client(request);
    }

    // Format and throw error
    if (error.response) {
      const { status, data } = error.response;
      // Handle different response data formats
      let message, errorType;

      if (data && typeof data === 'object') {
        message = data.message || 'An error occurred with the API request';
        errorType = data.error || undefined;
      } else {
        message = `${error.response.statusText || 'Error'} (${status})`;
      }

      throw new ClientError(message, status, errorType);
    } else if (error.request) {
      // Request was made but no response received
      throw new ClientError('No response received from server', 0);
    } else {
      // Request setup error
      throw new ClientError(error.message, 0);
    }
  }

  /**
   * Send a GET request
   * @param url Request URL
   * @param config Axios request config
   */
  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  /**
   * Send a POST request
   * @param url Request URL
   * @param data Request payload
   * @param config Axios request config
   */
  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  /**
   * Send a PUT request
   * @param url Request URL
   * @param data Request payload
   * @param config Axios request config
   */
  async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  /**
   * Send a DELETE request
   * @param url Request URL
   * @param config Axios request config
   */
  async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}
