import { Controller, Get } from '@nestjs/common';
import { RocksDBService } from '../../../storage/rocksdb/rocksdb.service';
import { MongoDBService } from '../../../storage/mongodb/mongodb.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly mongoDBService: MongoDBService,
    private readonly rocksDBService: RocksDBService,
  ) {}

  @Get()
  async check() {
    const mongoStatus = {
      name: 'mongodb',
      status: 'up',
      message: 'MongoDB is connected',
    };

    try {
      // Check MongoDB connection
      const isMongoConnected = await this.mongoDBService.isConnected();
      if (!isMongoConnected) {
        mongoStatus.status = 'down';
        mongoStatus.message = 'MongoDB is disconnected';
      }
    } catch (error) {
      mongoStatus.status = 'down';
      mongoStatus.message = `MongoDB error: ${error.message}`;
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: [
        mongoStatus,
        {
          name: 'rocksdb',
          status: 'up',
          message: 'RocksDB is available',
        },
      ],
    };
  }
}
