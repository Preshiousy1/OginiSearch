import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getHealth() {
    // OginiClient healthCheck expects status; optional version and server_info for detailed checks
    return {
      status: 'ok',
      version: process.env.npm_package_version ?? '1.0.0',
      server_info: { node: process.version },
    };
  }
}
