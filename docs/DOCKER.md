# Docker Setup Guide

This guide explains how to run the LLM Service using Docker.

## Prerequisites

- Docker and Docker Compose installed
- Azure Storage connection string
- OpenAI API key

## Quick Start

1. **Copy the environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file** with your actual credentials:
   - `AZURE_STORAGE_CONNECTION_STRING` - Your Azure Storage connection string
   - `OPENAI_API_KEY` - Your OpenAI API key
   - Adjust other settings as needed

3. **Start the services:**
   ```bash
   docker-compose up -d
   ```

4. **Check logs:**
   ```bash
   docker-compose logs -f api
   ```

5. **Verify the API is running:**
   ```bash
   curl http://localhost:4000/api/health
   ```

## Services

### API Service
- **Port:** 4000 (configurable via `API_PORT` env var)
- **Health Check:** `GET /api/health`
- **Main Endpoint:** `GET /api`

### MongoDB Service
- **Port:** 27017
- **Database:** `llm-service` (configurable via `MONGODB_DB_NAME`)
- **Data Persistence:** Stored in Docker volume `mongodb_data`

## Development Mode

For development with hot reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

This will:
- Mount source code as volumes for hot reload
- Run in development mode
- Use separate volumes for development data

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `production` | No |
| `API_PORT` | API server port | `4000` | No |
| `MONGODB_URI` | MongoDB connection string | `mongodb://mongodb:27017/llm-service` | No |
| `MONGODB_DB_NAME` | MongoDB database name | `llm-service` | No |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage connection string | - | **Yes** |
| `OPENAI_API_KEY` | OpenAI API key | - | **Yes** |
| `OPENAI_MODEL` | Default OpenAI model | `gpt-5-nano` | No |
| `IMAGE_CONTAINER_NAME` | Container name for generated images | `generated-images` | No |

## Useful Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f api
docker-compose logs -f mongodb

# Restart a service
docker-compose restart api

# Rebuild containers
docker-compose build

# Remove all containers and volumes
docker-compose down -v

# Execute commands in API container
docker-compose exec api bun <command>

# Check service status
docker-compose ps
```

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB container is healthy: `docker-compose ps`
- Check MongoDB logs: `docker-compose logs mongodb`
- Verify connection string format: `mongodb://mongodb:27017/llm-service`

### API Service Issues
- Check API logs: `docker-compose logs api`
- Verify environment variables are set correctly
- Ensure MongoDB is healthy before API starts

### Port Conflicts
- Change `API_PORT` in `.env` if port 4000 is already in use
- Change MongoDB port mapping in `docker-compose.yml` if 27017 is in use

## Production Considerations

1. **Use secrets management** for sensitive environment variables
2. **Set up proper backups** for MongoDB volumes
3. **Configure reverse proxy** (nginx/traefik) for SSL termination
4. **Set resource limits** in docker-compose.yml
5. **Use production-grade MongoDB** with replica sets for HA
6. **Enable MongoDB authentication** in production

## Data Persistence

MongoDB data is persisted in Docker volumes:
- `mongodb_data` - Database files
- `mongodb_config` - MongoDB configuration

To backup:
```bash
docker-compose exec mongodb mongodump --out /data/backup
```

To restore:
```bash
docker-compose exec mongodb mongorestore /data/backup
```

