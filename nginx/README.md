# Nginx Configuration

This directory contains Nginx configuration files for the LLM Service reverse proxy.

## Files

- `config/nginx.conf` - Main Nginx configuration
- `config/default.conf` - Server block configuration with Basic Auth
- `config/.htpasswd` - Basic Authentication password file (generated)
- `generate-htpasswd.sh` - Script to generate htpasswd file

## Setup

### Generate Basic Auth Password File

1. **Using the script** (recommended):
   ```bash
   chmod +x nginx/generate-htpasswd.sh
   ./nginx/generate-htpasswd.sh <username> <password>
   ```

2. **Using htpasswd directly**:
   ```bash
   # Create new file
   htpasswd -B -c nginx/config/.htpasswd <username>
   
   # Add additional users
   htpasswd -B nginx/config/.htpasswd <username>
   ```

### Install htpasswd

- **Ubuntu/Debian**: `sudo apt-get install apache2-utils`
- **CentOS/RHEL**: `sudo yum install httpd-tools`
- **Arch Linux**: `sudo pacman -S apache`
- **macOS**: `brew install httpd` (or use Docker)

### Using Docker to Generate htpasswd

If you don't have htpasswd installed locally:

```bash
docker run --rm -v "$(pwd)/nginx/config:/etc/nginx" httpd:2.4 \
  htpasswd -B -c /etc/nginx/.htpasswd <username>
# Enter password when prompted
```

## Configuration

### Basic Authentication

All requests to `/api/*` require Basic Authentication. The credentials are stored in `nginx/config/.htpasswd`.

### Public Endpoints

- `/health` - Health check endpoint (can be made public)

### Proxied Routes

- `/api/*` - All API routes are proxied to the API service

## Security Notes

- The `.htpasswd` file uses bcrypt encryption (`-B` flag)
- Keep the `.htpasswd` file secure and never commit it to version control
- Consider using environment variables or secrets management in production
- For production, consider:
  - SSL/TLS termination
  - Rate limiting
  - IP whitelisting
  - More sophisticated authentication (OAuth2, JWT)

## Troubleshooting

### Check Nginx logs

```bash
docker-compose logs nginx
```

### Test configuration

```bash
docker-compose exec nginx nginx -t
```

### Verify Basic Auth

```bash
curl -u username:password http://localhost/api/health
```

