import { Logger, formatMessage } from '@llm-service/shared-utils';

const logger = new Logger('WebApp');

const port = parseInt(process.env.WEB_PORT || process.env.PORT || '3000');
const host = process.env.HOST || 'localhost';

const server = Bun.serve({
  port,
  hostname: host,
  fetch(req: Request) {
    const url = new URL(req.url);
    
    logger.info(`Serving ${url.pathname}`);

    switch (url.pathname) {
      case '/':
        return Response.json({ 
          message: 'Welcome to LLM Service Web App' 
        });
      
      case '/health':
        return Response.json({ 
          status: 'ok', 
          timestamp: new Date().toISOString() 
        });
      
      default:
        return new Response('Not Found', { status: 404 });
    }
  },
});

logger.info(formatMessage(`Web server started on http://${host}:${port}`));