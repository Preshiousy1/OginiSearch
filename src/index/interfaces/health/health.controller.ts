import { Controller, Get } from '@nestjs/common';
import { PostgreSQLService } from '../../../storage/postgresql/postgresql.service';

@Controller('health')
export class HealthController {
  constructor(private readonly postgresqlService: PostgreSQLService) {}

  @Get()
  async checkHealth() {
    try {
      // Check PostgreSQL connection
      await this.postgresqlService.query('SELECT 1');
      return { status: 'ok', message: 'All services are healthy' };
    } catch (error) {
      return { status: 'error', message: error.message };
    }
  }
}
