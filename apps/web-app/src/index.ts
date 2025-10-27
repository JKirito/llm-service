import { Elysia } from 'elysia';
import { Logger, formatMessage } from '@llm-service/shared-utils';

const logger = new Logger('WebApp');

const app = new Elysia()
  .get('/', () => {
    logger.info('Serving root route');
    return { message: 'Welcome to LLM Service Web App' };
  })
  .get('/health', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  })
  .listen(3000);

logger.info(formatMessage('Server started on http://localhost:3000'));

export default app;
