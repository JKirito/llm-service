# Docker Setup Guide

This guide explains how to run the LLM Service using Docker.

## Prerequisites

- Docker and Docker Compose installed
- Azure Storage connection string
- OpenAI API key
- `htpasswd` utility (for Basic Authentication setup)

## Quick Start

1. **Copy the environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Edit `.env` file** with your actual credentials:
   - `AZURE_STORAGE_CONNECTION_STRING` - Your Azure Storage connection string
   - `OPENAI_API_KEY` - Your OpenAI API key
   - Adjust other settings as needed

3. **Set up Basic Authentication:**
   
   Generate the `.htpasswd` file that Nginx will use for Basic Authentication:
   
   ```bash
   # Make the script executable
   chmod +x nginx/generate-htpasswd.sh
   
   # Generate htpasswd file (replace 'admin' and 'password123' with your credentials)
   ./nginx/generate-htpasswd.sh admin password123
   ```
   
   This creates `nginx/config/.htpasswd` with bcrypt-encrypted credentials.
   
   **Alternative methods:**
   - If you have `htpasswd` installed: `htpasswd -B -c nginx/config/.htpasswd admin`
   - Using Docker: `docker run --rm -v "$(pwd)/nginx/config:/etc/nginx" httpd:2.4 htpasswd -B -c /etc/nginx/.htpasswd admin`
   
   **Note:** See [Basic Authentication Setup](#basic-authentication-setup) for detailed instructions and troubleshooting.

4. **Start the services:**
   ```bash
   docker-compose up -d
   ```

5. **Check logs:**
   ```bash
   docker-compose logs -f nginx
   docker-compose logs -f api
   ```

6. **Verify the API is running through Nginx:**
   ```bash
   # Access via Nginx (requires Basic Auth)
   curl -u username:password http://localhost/api/health
   
   # Or in production (API not directly exposed):
   curl -u username:password http://localhost/api
   ```

## Services

### Nginx Reverse Proxy
- **Port:** 80 (configurable via `NGINX_PORT` env var)
- **Purpose:** Reverse proxy with Basic Authentication
- **Access:** All API requests go through Nginx on port 80
- **Health Check:** `GET /health` (public, no auth required)

### API Service
- **Port:** 4000 (internal only, not exposed directly in production)
- **Health Check:** `GET /api/health`
- **Main Endpoint:** `GET /api`
- **Access:** Via Nginx reverse proxy only (production) or directly on port 4000 (development)

### MongoDB Service
- **Port:** 27017
- **Database:** `llm-service` (configurable via `MONGODB_DB_NAME`)
- **Data Persistence:** Stored in Docker volume `mongodb_data`

### Redis Service
- **Port:** 6379 (configurable via `REDIS_PORT` env var)
- **Purpose:** Rate limiting storage and caching
- **Data Persistence:** Stored in Docker volume `redis_data`
- **Persistence:** AOF (Append Only File) enabled for durability

## Basic Authentication Setup

The API is protected by Basic Authentication through Nginx. You need to create a `.htpasswd` file before starting the services. This file contains encrypted credentials that Nginx uses to authenticate requests.

**Quick Command:**
```bash
chmod +x nginx/generate-htpasswd.sh && ./nginx/generate-htpasswd.sh admin password123
```

**File Created:** `nginx/config/.htpasswd` (this file is used by Nginx to authenticate requests)

### Understanding htpasswd

The `.htpasswd` file stores username/password pairs in an encrypted format. Nginx reads this file and prompts users for credentials before allowing access to protected endpoints.

**File location:** `nginx/config/.htpasswd`  
**Format:** `username:encrypted_password` (one per line)  
**Encryption:** bcrypt (recommended, more secure)

### Method 1: Using the provided script (recommended)

The easiest way to generate the `.htpasswd` file:

```bash
# Make script executable (if not already)
chmod +x nginx/generate-htpasswd.sh

# Generate htpasswd file
./nginx/generate-htpasswd.sh <username> <password>

# Example:
./nginx/generate-htpasswd.sh admin mySecurePassword123
```

This script:
- Checks if `htpasswd` is installed
- Creates `nginx/config/.htpasswd` with bcrypt encryption
- Provides instructions for adding more users

### Method 2: Using htpasswd directly

If you have `htpasswd` installed locally:

```bash
# Create new file with first user
htpasswd -B -c nginx/config/.htpasswd <username>
# Enter password when prompted

# Add additional users (without -c flag)
htpasswd -B nginx/config/.htpasswd <another_username>
# Enter password when prompted

# Change password for existing user
htpasswd -B nginx/config/.htpasswd <username>
```

**Flags explained:**
- `-B` - Use bcrypt encryption (recommended)
- `-c` - Create new file (only use for first user)

### Method 3: Using Docker (if htpasswd not installed locally)

If you don't have `htpasswd` installed, use Docker:

```bash
# Create new file with first user
docker run --rm -v "$(pwd)/nginx/config:/etc/nginx" httpd:2.4 \
  htpasswd -B -c /etc/nginx/.htpasswd <username>
# Enter password when prompted

# Add additional users (without -c flag)
docker run --rm -v "$(pwd)/nginx/config:/etc/nginx" httpd:2.4 \
  htpasswd -B /etc/nginx/.htpasswd <another_username>
# Enter password when prompted
```

### Installing htpasswd

Install `htpasswd` on your system:

- **Ubuntu/Debian**: `sudo apt-get install apache2-utils`
- **CentOS/RHEL**: `sudo yum install httpd-tools`
- **Arch Linux**: `sudo pacman -S apache`
- **macOS**: `brew install httpd`
- **Windows**: Use WSL or Docker method above

### Verifying htpasswd File

After generating the file, verify it exists and has correct permissions:

```bash
# Check if file exists
ls -la nginx/config/.htpasswd

# Expected output should show:
# -rw-r--r-- 1 user user 60 date nginx/config/.htpasswd

# View file contents (first 2 fields are username:encrypted_password)
cat nginx/config/.htpasswd
# Example output: admin:$2y$10$xyz123...encrypted_password_hash

# Set correct permissions (if needed)
chmod 644 nginx/config/.htpasswd
```

### How Nginx Uses htpasswd

1. Client makes request to `/api/*`
2. Nginx checks for `Authorization: Basic ...` header
3. If missing, returns `401 Unauthorized` with `WWW-Authenticate` header
4. Client sends credentials in `Authorization` header
5. Nginx reads `.htpasswd` file and compares credentials
6. If match, request is proxied to API service
7. If no match, returns `401 Unauthorized`

### Using the API with Basic Auth

All API requests must include Basic Authentication:

```bash
# Using curl
curl -u username:password http://localhost/api/health

# Using curl with explicit header
curl -H "Authorization: Basic $(echo -n 'username:password' | base64)" \
  http://localhost/api/health

# In JavaScript/TypeScript
fetch('http://localhost/api/health', {
  headers: {
    'Authorization': 'Basic ' + btoa('username:password')
  }
})
```

## Development Mode

For development with hot reload:

```bash
docker-compose -f docker-compose.dev.yml up
```

This will:
- Mount source code as volumes for hot reload
- Run in development mode
- Use separate volumes for development data
- **Note:** In development mode, the API is accessible both:
  - Through Nginx on port 80 (with Basic Auth)
  - Directly on port 4000 (for convenience, no auth)

**Development API Access:**
- Via Nginx: `http://localhost/api` (requires Basic Auth)
- Direct: `http://localhost:4000/api` (no auth, for debugging)

## Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode | `production` | No |
| `NGINX_PORT` | Nginx port (public access) | `80` | No |
| `API_PORT` | API server port (internal/dev) | `4000` | No |
| `MONGODB_URI` | MongoDB connection string | `mongodb://mongodb:27017/llm-service` | No |
| `MONGODB_DB_NAME` | MongoDB database name | `llm-service` | No |
| `AZURE_STORAGE_CONNECTION_STRING` | Azure Storage connection string | - | **Yes** |
| `OPENAI_API_KEY` | OpenAI API key | - | **Yes** |
| `OPENAI_MODEL` | Default OpenAI model | `gpt-5-nano` | No |
| `IMAGE_CONTAINER_NAME` | Container name for generated images | `generated-images` | No |
| `REDIS_HOST` | Redis hostname | `redis` | **Yes** |
| `REDIS_PORT` | Redis port | `6379` | No |
| `REDIS_PASSWORD` | Redis password (optional) | - | No |
| `REDIS_DB` | Redis database number | `0` | No |

## Useful Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f nginx
docker-compose logs -f api
docker-compose logs -f mongodb
docker-compose logs -f redis

# Restart a service
docker-compose restart nginx
docker-compose restart api
docker-compose restart redis

# Rebuild containers
docker-compose build

# Remove all containers and volumes
docker-compose down -v

# Execute commands in containers
docker-compose exec api bun <command>
docker-compose exec nginx nginx -t  # Test Nginx config

# Check service status
docker-compose ps
```

## Troubleshooting

### MongoDB Connection Issues
- Ensure MongoDB container is healthy: `docker-compose ps`
- Check MongoDB logs: `docker-compose logs mongodb`
- Verify connection string format: `mongodb://mongodb:27017/llm-service`

### Nginx Issues
- Check Nginx logs: `docker-compose logs nginx`
- Test Nginx configuration: `docker-compose exec nginx nginx -t`
- Verify `.htpasswd` file exists: `ls -la nginx/config/.htpasswd`
- Ensure `.htpasswd` file is readable: `chmod 644 nginx/config/.htpasswd`
- Check if Basic Auth credentials are correct: `cat nginx/config/.htpasswd`
- Verify Nginx can read the file: `docker-compose exec nginx cat /etc/nginx/.htpasswd`
- Check if htpasswd file format is correct (should be `username:encrypted_password`)
- Restart Nginx after creating/updating `.htpasswd`: `docker-compose restart nginx`

### API Service Issues
- Check API logs: `docker-compose logs api`
- Verify environment variables are set correctly
- Ensure MongoDB is healthy before API starts
- Ensure Redis is healthy before API starts (required for rate limiting)

### Redis Connection Issues
- Ensure Redis container is healthy: `docker-compose ps`
- Check Redis logs: `docker-compose logs redis`
- Verify Redis connection: `docker-compose exec redis redis-cli ping`
- Verify connection string format: `REDIS_HOST=redis` (use service name in Docker)
- Test Redis connection from API container: `docker-compose exec api bun -e "import('@llm-service/redis').then(m => m.getRedisClient().ping())"`

### Port Conflicts
- Change `NGINX_PORT` in `.env` if port 80 is already in use
- Change `API_PORT` in `.env` if port 4000 is already in use (development only)
- Change MongoDB port mapping in `docker-compose.yml` if 27017 is in use
- Change `REDIS_PORT` in `.env` if port 6379 is already in use

## Production Considerations

1. **Use secrets management** for sensitive environment variables
2. **Set up proper backups** for MongoDB volumes
3. **Configure SSL/TLS termination** in Nginx (add SSL certificates)
4. **Set resource limits** in docker-compose.yml
5. **Use production-grade MongoDB** with replica sets for HA
6. **Enable MongoDB authentication** in production
7. **Secure Basic Auth credentials** - use strong passwords and rotate regularly
8. **Consider upgrading to OAuth2/JWT** for more sophisticated authentication
9. **Set up rate limiting** in Nginx to prevent abuse
10. **Configure firewall rules** to only expose port 80 (or 443 for HTTPS)

## Data Persistence

MongoDB data is persisted in Docker volumes:
- `mongodb_data` - Database files
- `mongodb_config` - MongoDB configuration

Redis data is persisted in Docker volumes:
- `redis_data` - Redis AOF (Append Only File) persistence

To backup:
```bash
docker-compose exec mongodb mongodump --out /data/backup
docker-compose exec redis redis-cli --rdb /data/backup.rdb
```

To restore:
```bash
docker-compose exec mongodb mongorestore /data/backup
# Note: Redis restore requires copying RDB file to /data directory
```

## Nginx Configuration

The Nginx configuration is located in `nginx/config/`:
- `nginx.conf` - Main Nginx configuration
- `default.conf` - Server block with Basic Auth and proxy settings
- `.htpasswd` - Basic Authentication password file (generated)

### Customizing Nginx

You can customize the Nginx configuration by editing:
- `nginx/config/nginx.conf` - Global settings
- `nginx/config/default.conf` - Server-specific settings

After making changes, restart Nginx:
```bash
docker-compose restart nginx
# Or test config first
docker-compose exec nginx nginx -t && docker-compose restart nginx
```

### Making Endpoints Public

To make certain endpoints public (without Basic Auth), edit `nginx/config/default.conf`:

```nginx
# Example: Make health endpoint public
location /health {
    auth_basic off;  # Disable auth for this location
    proxy_pass http://api_backend/api/health;
}
```

### SSL/TLS Setup

To add SSL/TLS in production:

1. Obtain SSL certificates (Let's Encrypt, etc.)
2. Create `nginx/config/ssl/` directory
3. Place certificates there
4. Update `nginx/config/default.conf` to include SSL configuration
5. Update `docker-compose.yml` to expose port 443

See [nginx/README.md](../nginx/README.md) for more details.
