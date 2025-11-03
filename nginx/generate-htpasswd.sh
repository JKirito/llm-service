#!/bin/bash

# Script to generate htpasswd file for Nginx Basic Authentication
# Usage: ./generate-htpasswd.sh <username> <password>

set -e

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <username> <password>"
    echo "Example: $0 admin mypassword123"
    exit 1
fi

USERNAME=$1
PASSWORD=$2
HTPASSWD_FILE="nginx/config/.htpasswd"

# Check if htpasswd is available
if ! command -v htpasswd &> /dev/null; then
    echo "Error: htpasswd command not found."
    echo "Install apache2-utils (Debian/Ubuntu) or httpd-tools (CentOS/RHEL):"
    echo "  Ubuntu/Debian: sudo apt-get install apache2-utils"
    echo "  CentOS/RHEL: sudo yum install httpd-tools"
    echo "  Arch: sudo pacman -S apache"
    exit 1
fi

# Create directory if it doesn't exist
mkdir -p "$(dirname "$HTPASSWD_FILE")"

# Generate htpasswd file
# -B: Use bcrypt encryption
# -c: Create new file (will overwrite existing)
htpasswd -B -c "$HTPASSWD_FILE" "$USERNAME" <<< "$PASSWORD"

echo "✓ Generated htpasswd file: $HTPASSWD_FILE"
echo "✓ Username: $USERNAME"
echo ""
echo "Note: To add more users, run:"
echo "  htpasswd -B $HTPASSWD_FILE <new_username>"
echo ""
echo "To change password:"
echo "  htpasswd -B $HTPASSWD_FILE <username>"

