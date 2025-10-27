import { Elysia } from 'elysia';
import { createLogger } from '@llm-service/logger';
import type { ApiResponse } from '@llm-service/types';
import { formatMessage } from '@llm-service/shared-utils';

const logger = createLogger('API');

const app = new Elysia()
  .get('/', () => {
    logger.info('Serving API root route');
    const response: ApiResponse = {
      success: true,
      message: 'LLM Service API is running',
    };
    return response;
  })
  .get('/health', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  })
  .get('/api/users', () => {
    logger.info('Fetching users');
    const response: ApiResponse = {
      success: true,
      data: [],
      message: 'Users retrieved successfully',
    };
    return response;
  })
  .listen(3001);

logger.info(formatMessage('API server started on http://localhost:3001'));

export default app;
